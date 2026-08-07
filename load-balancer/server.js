/**
 * AI Agent Pro — simple reverse load balancer
 * Health-check based round-robin. Manage backends via UI or servers.json
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
    };
  }
  return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
}

function saveConfig(cfg) {
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

let cfg = loadConfig();
/** @type {Map<string, {ok:boolean, ms:number, last:string, error?:string}>} */
const health = new Map();
let rr = 0;

function checkOne(url) {
  return new Promise((resolve) => {
    const target = url.replace(/\/$/, "") + (cfg.healthPath || "/api/health");
    const lib = target.startsWith("https") ? https : http;
    const t0 = Date.now();
    const req = lib.get(target, { timeout: cfg.timeoutMs || 12000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        const ms = Date.now() - t0;
        const ok = res.statusCode >= 200 && res.statusCode < 500;
        health.set(url, { ok, ms, last: new Date().toISOString() });
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
  const list = cfg.backends || [];
  await Promise.all(list.map((u) => checkOne(u)));
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

  // CORS for UI
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
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, backends, config: cfg, time: new Date().toISOString() }));
  }
  if (path === "/lb/backends" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ backends: cfg.backends || [] }));
  }
  if (path === "/lb/backends" && req.method === "POST") {
    const body = await readBody(req);
    const url = String(body.url || "").replace(/\/$/, "");
    if (!url.startsWith("http")) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "url must start with http" }));
    }
    cfg = loadConfig();
    if (!cfg.backends.includes(url)) cfg.backends.push(url);
    saveConfig(cfg);
    await checkOne(url);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, backends: cfg.backends }));
  }
  if (path === "/lb/backends" && req.method === "DELETE") {
    const body = await readBody(req);
    const url = String(body.url || "").replace(/\/$/, "");
    cfg = loadConfig();
    cfg.backends = (cfg.backends || []).filter((u) => u !== url);
    saveConfig(cfg);
    health.delete(url);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, backends: cfg.backends }));
  }
  if (path === "/lb/health-now" && req.method === "POST") {
    await healthLoop();
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  // Proxy API traffic
  const backend = pickBackend();
  if (!backend) {
    res.writeHead(503, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "no_backends" }));
  }
  return proxy(req, res, backend);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`AAP Load Balancer → http://0.0.0.0:${PORT}`);
  console.log(`UI: /   status: /lb/status   backends: ${cfg.backends?.length || 0}`);
});
