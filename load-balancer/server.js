/**
 * AI Agent Pro — reverse load balancer
 * - Round-robin + health checks
 * - Backends: full URLs or IP:port (http/https)
 * - UI to add / edit / remove
 * - Optional CIDR notes (74.220.52.0/24, 74.220.60.0/24)
 */
import http from "http";
import https from "https";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const CONFIG_FILE = join(__dirname, "servers.json");

function loadConfig() {
  if (!existsSync(CONFIG_FILE)) {
    return {
      backends: [],
      healthPath: "/api/health",
      healthIntervalMs: 20000,
      timeoutMs: 12000,
      allowedCidrs: ["74.220.52.0/24", "74.220.60.0/24"],
    };
  }
  return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
}

function saveConfig(cfg) {
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

/** Normalize user input → http(s) URL */
function normalizeBackend(input) {
  let s = String(input || "").trim().replace(/\/$/, "");
  if (!s) return null;
  // bare IP or IP:port
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(s)) {
    s = "http://" + s;
  }
  // host without scheme
  if (!/^https?:\/\//i.test(s)) {
    s = "http://" + s;
  }
  try {
    const u = new URL(s);
    if (!u.hostname) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function ipToInt(ip) {
  return ip.split(".").reduce((a, o) => (a << 8) + (Number(o) & 255), 0) >>> 0;
}

function cidrContains(cidr, ip) {
  try {
    const [base, bitsStr] = cidr.split("/");
    const bits = Number(bitsStr);
    if (!base || Number.isNaN(bits)) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipToInt(base) & mask) === (ipToInt(ip) & mask);
  } catch {
    return false;
  }
}

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || req.socket?.remoteAddress || "";
}

let cfg = loadConfig();
const health = new Map();
let rr = 0;

function checkOne(url) {
  return new Promise((resolve) => {
    const target = url.replace(/\/$/, "") + (cfg.healthPath || "/api/health");
    const lib = target.startsWith("https") ? https : http;
    const t0 = Date.now();
    const req = lib.get(target, { timeout: cfg.timeoutMs || 12000 }, (res) => {
      res.resume();
      res.on("end", () => {
        const ok = res.statusCode >= 200 && res.statusCode < 500;
        health.set(url, { ok, ms: Date.now() - t0, last: new Date().toISOString() });
        resolve(ok);
      });
    });
    req.on("error", (e) => {
      health.set(url, {
        ok: false,
        ms: Date.now() - t0,
        last: new Date().toISOString(),
        error: e.message,
      });
      resolve(false);
    });
    req.on("timeout", () => {
      req.destroy();
      health.set(url, {
        ok: false,
        ms: Date.now() - t0,
        last: new Date().toISOString(),
        error: "timeout",
      });
      resolve(false);
    });
  });
}

async function healthLoop() {
  cfg = loadConfig();
  await Promise.all((cfg.backends || []).map((u) => checkOne(u)));
}
setInterval(healthLoop, 20000);
healthLoop();

function pickBackend() {
  const up = (cfg.backends || []).filter((u) => health.get(u)?.ok !== false);
  const pool = up.length ? up : cfg.backends || [];
  if (!pool.length) return null;
  rr = (rr + 1) % pool.length;
  return pool[rr];
}

function proxy(clientReq, clientRes, backend) {
  const u = new URL(clientReq.url || "/", backend);
  const lib = backend.startsWith("https") ? https : http;
  const headers = { ...clientReq.headers, host: u.host };
  delete headers["accept-encoding"];

  const preq = lib.request(
    {
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method: clientReq.method,
      headers,
      timeout: cfg.timeoutMs || 30000,
    },
    (pres) => {
      clientRes.writeHead(pres.statusCode || 502, pres.headers);
      pres.pipe(clientRes);
    }
  );
  preq.on("error", (e) => {
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { "content-type": "application/json" });
    }
    clientRes.end(JSON.stringify({ error: "bad_gateway", detail: e.message, backend }));
  });
  clientReq.pipe(preq);
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function serveStatic(res, file, type) {
  try {
    const html = readFileSync(join(__dirname, "public", file));
    res.writeHead(200, { "content-type": type });
    res.end(html);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

const server = http.createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS,PATCH");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-token");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (path === "/" || path === "/lb") {
    return serveStatic(res, "index.html", "text/html; charset=utf-8");
  }

  if (path === "/lb/status") {
    cfg = loadConfig();
    const backends = (cfg.backends || []).map((url) => ({
      url,
      ...(health.get(url) || { ok: null, ms: null, last: null }),
    }));
    const ip = clientIp(req).replace(/^::ffff:/, "");
    const cidrs = cfg.allowedCidrs || [];
    const ipAllowed = !cidrs.length || cidrs.some((c) => cidrContains(c, ip));
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(
      JSON.stringify({
        ok: true,
        backends,
        allowedCidrs: cidrs,
        clientIp: ip,
        clientIpInAllowList: ipAllowed,
        config: {
          healthPath: cfg.healthPath,
          healthIntervalMs: cfg.healthIntervalMs,
          timeoutMs: cfg.timeoutMs,
        },
        time: new Date().toISOString(),
      })
    );
  }

  if (path === "/lb/backends" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ backends: cfg.backends || [], allowedCidrs: cfg.allowedCidrs || [] }));
  }

  if (path === "/lb/backends" && req.method === "POST") {
    const body = await readBody(req);
    const url = normalizeBackend(body.url);
    if (!url) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "invalid url or ip — examples: https://x.onrender.com or 74.220.52.10:3000" }));
    }
    cfg = loadConfig();
    if (!cfg.backends.includes(url)) cfg.backends.push(url);
    saveConfig(cfg);
    await checkOne(url);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, backends: cfg.backends, added: url }));
  }

  // Edit: replace old URL with new
  if (path === "/lb/backends" && req.method === "PUT") {
    const body = await readBody(req);
    const from = normalizeBackend(body.from || body.old);
    const to = normalizeBackend(body.to || body.url || body.new);
    if (!from || !to) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "from and to required (url or ip)" }));
    }
    cfg = loadConfig();
    const idx = (cfg.backends || []).indexOf(from);
    if (idx < 0) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "backend not found", from }));
    }
    cfg.backends[idx] = to;
    cfg.backends = [...new Set(cfg.backends)];
    saveConfig(cfg);
    health.delete(from);
    await checkOne(to);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, backends: cfg.backends }));
  }

  if (path === "/lb/backends" && req.method === "DELETE") {
    const body = await readBody(req);
    const url = normalizeBackend(body.url);
    cfg = loadConfig();
    cfg.backends = (cfg.backends || []).filter((u) => u !== url);
    saveConfig(cfg);
    if (url) health.delete(url);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, backends: cfg.backends }));
  }

  if (path === "/lb/cidrs" && req.method === "POST") {
    const body = await readBody(req);
    cfg = loadConfig();
    if (Array.isArray(body.allowedCidrs)) {
      cfg.allowedCidrs = body.allowedCidrs.map(String);
    } else if (body.cidr) {
      const c = String(body.cidr).trim();
      cfg.allowedCidrs = cfg.allowedCidrs || [];
      if (c && !cfg.allowedCidrs.includes(c)) cfg.allowedCidrs.push(c);
    }
    saveConfig(cfg);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, allowedCidrs: cfg.allowedCidrs }));
  }

  if (path === "/lb/health-now" && req.method === "POST") {
    await healthLoop();
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  const backend = pickBackend();
  if (!backend) {
    res.writeHead(503, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "no_backends" }));
  }
  return proxy(req, res, backend);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`AAP Load Balancer → http://0.0.0.0:${PORT}`);
  console.log(`UI /  · status /lb/status  · backends ${cfg.backends?.length || 0}`);
  console.log(`CIDRs: ${(cfg.allowedCidrs || []).join(", ") || "none"}`);
});
