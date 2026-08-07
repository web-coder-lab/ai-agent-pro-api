/**
 * Phase 37 — VPS Registry + SSH Broker
 * Register hosts; credentials via vault (Credential Broker); scoped SSH exec.
 */

import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { log } from "./logger.js";
import { addCredential, findCredential, resolveSecret, listCredentials } from "./credentialBroker.js";
import { openSession, closeSession } from "./sessionBroker.js";

const DATA = join(process.cwd(), ".data");
const REG_PRIMARY = join(DATA, "vps-registry.json");
const REG_FALLBACK = join("/tmp", "ai-agent-pro-vps.json");
mkdirSync(DATA, { recursive: true });

export type VpsTarget = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  /** credential id in broker (ssh kind) — never raw key in registry */
  credentialId?: string;
  tags: string[];
  createdAt: string;
  lastSeenAt?: string;
  lastError?: string;
  status: "unknown" | "online" | "offline" | "error";
};

type Store = { targets: VpsTarget[] };

let _path: string | null = null;
function regPath(): string {
  if (_path) return _path;
  try {
    mkdirSync(DATA, { recursive: true });
    if (!existsSync(REG_PRIMARY)) writeFileSync(REG_PRIMARY, JSON.stringify({ targets: [] }));
    _path = REG_PRIMARY;
  } catch {
    _path = REG_FALLBACK;
  }
  return _path;
}

function load(): Store {
  try {
    if (!existsSync(regPath())) return { targets: [] };
    const s = JSON.parse(readFileSync(regPath(), "utf8"));
    return { targets: Array.isArray(s.targets) ? s.targets : [] };
  } catch {
    return { targets: [] };
  }
}

function save(s: Store) {
  try {
    writeFileSync(regPath(), JSON.stringify(s, null, 2));
  } catch {
    writeFileSync(REG_FALLBACK, JSON.stringify(s, null, 2));
  }
}

export function listVps(): VpsTarget[] {
  return load().targets.sort((a, b) => a.name.localeCompare(b.name));
}

export function getVps(id: string): VpsTarget | null {
  return load().targets.find((t) => t.id === id) || null;
}

export function registerVps(input: {
  name: string;
  host: string;
  port?: number;
  username: string;
  /** raw private key or password — stored in vault as ssh credential */
  secret?: string;
  credentialId?: string;
  tags?: string[];
}): VpsTarget {
  if (!input.host || !input.username) throw new Error("host and username required");

  let credentialId = input.credentialId;
  if (input.secret && !credentialId) {
    const cred = addCredential({
      service: "ssh",
      label: `ssh:${input.name || input.host}`,
      secret: input.secret,
      principal: `${input.username}@${input.host}`,
      scopes: ["ssh:exec"],
    });
    credentialId = cred.id;
  }

  const target: VpsTarget = {
    id: randomUUID().slice(0, 10),
    name: input.name || input.host,
    host: input.host,
    port: input.port || 22,
    username: input.username,
    credentialId,
    tags: input.tags || [],
    createdAt: new Date().toISOString(),
    status: "unknown",
  };

  const s = load();
  s.targets.unshift(target);
  save(s);
  log("info", `VPS registered ${target.name} ${target.host}`, "vps");
  return target;
}

export function updateVps(
  id: string,
  patch: Partial<Pick<VpsTarget, "name" | "host" | "port" | "username" | "credentialId" | "tags" | "status">>
): VpsTarget {
  const s = load();
  const t = s.targets.find((x) => x.id === id);
  if (!t) throw new Error("VPS not found");
  Object.assign(t, patch);
  save(s);
  return t;
}

export function removeVps(id: string): boolean {
  const s = load();
  const before = s.targets.length;
  s.targets = s.targets.filter((t) => t.id !== id);
  save(s);
  return s.targets.length < before;
}

function runSsh(args: string[], opts?: { input?: string; timeoutMs?: number }): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    const child = spawn("ssh", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: 124, stdout, stderr: stderr + "\n[timeout]" });
    }, opts?.timeoutMs || 20000);

    if (opts?.input) {
      child.stdin?.write(opts.input);
      child.stdin?.end();
    } else {
      child.stdin?.end();
    }
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
      if (stdout.length > 100_000) stdout = stdout.slice(-100_000);
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 50_000) stderr = stderr.slice(-50_000);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout: "", stderr: err.message });
    });
  });
}

/** Write key material to temp file for ssh -i (deleted after) */
async function withIdentityFile(
  credentialId: string | undefined,
  fn: (identityArgs: string[]) => Promise<{ code: number; stdout: string; stderr: string }>
) {
  if (!credentialId) return fn([]);
  const secret = resolveSecret(credentialId);
  if (!secret) return fn([]);

  // password vs key heuristic
  const isKey = secret.includes("BEGIN") && secret.includes("KEY");
  if (!isKey) {
    // password auth needs sshpass — often unavailable; report clearly
    return {
      code: 1,
      stdout: "",
      stderr: "Password SSH requires sshpass or key-based auth. Store a private key as the SSH credential.",
    };
  }

  const keyPath = join("/tmp", `ai-agent-ssh-${randomUUID().slice(0, 8)}`);
  writeFileSync(keyPath, secret.endsWith("\n") ? secret : secret + "\n", { mode: 0o600 });
  try {
    return await fn(["-i", keyPath]);
  } finally {
    try {
      const { unlinkSync } = await import("fs");
      unlinkSync(keyPath);
    } catch {
      /* */
    }
  }
}

export async function checkVps(id: string): Promise<VpsTarget> {
  const s = load();
  const t = s.targets.find((x) => x.id === id);
  if (!t) throw new Error("VPS not found");

  const baseArgs = [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=no",
    "-o", "ConnectTimeout=8",
    "-p", String(t.port),
    `${t.username}@${t.host}`,
    "echo", "ok",
  ];

  const result = await withIdentityFile(t.credentialId, (idArgs) =>
    runSsh([...idArgs, ...baseArgs], { timeoutMs: 12000 })
  );

  if (result.code === 0 && result.stdout.includes("ok")) {
    t.status = "online";
    t.lastSeenAt = new Date().toISOString();
    t.lastError = undefined;
  } else {
    t.status = result.code === 124 ? "offline" : "error";
    t.lastError = (result.stderr || result.stdout || "unreachable").slice(0, 300);
  }
  save(s);
  return t;
}

/** Block obvious destructive remote commands */
function assertSafeRemoteCommand(cmd: string) {
  const blocked = [/\brm\s+(-[a-zA-Z]*f\s+)?\/($|\s)/, /\bmkfs\b/, /\bdd\s+if=/, /:\(\)\s*\{\s*:\|:\s*&\s*\};:/];
  for (const re of blocked) {
    if (re.test(cmd)) throw new Error("Remote command blocked for safety");
  }
}

export async function execOnVps(
  id: string,
  command: string,
  opts?: { deviceId?: string }
): Promise<{
  vpsId: string;
  command: string;
  code: number;
  stdout: string;
  stderr: string;
  sessionId?: string;
}> {
  const t = getVps(id);
  if (!t) throw new Error("VPS not found");
  assertSafeRemoteCommand(command);

  // session slot on this VPS
  const slot = openSession({
    kind: "ssh",
    deviceId: opts?.deviceId || "api",
    vpsId: t.id,
    label: `ssh:${t.name}`,
    meta: { command: command.slice(0, 80) },
  });
  if (!slot.ok) {
    throw new Error(slot.error);
  }

  try {
    const baseArgs = [
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=no",
      "-o", "ConnectTimeout=10",
      "-p", String(t.port),
      `${t.username}@${t.host}`,
      command,
    ];
    const result = await withIdentityFile(t.credentialId, (idArgs) =>
      runSsh([...idArgs, ...baseArgs], { timeoutMs: 30000 })
    );

    // update status
    const s = load();
    const row = s.targets.find((x) => x.id === id);
    if (row) {
      if (result.code === 0) {
        row.status = "online";
        row.lastSeenAt = new Date().toISOString();
        row.lastError = undefined;
      } else if (result.code === 124) {
        row.status = "offline";
        row.lastError = "timeout";
      }
      save(s);
    }

    log("info", `SSH ${t.host} exit=${result.code}`, "vps");
    return {
      vpsId: id,
      command,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      sessionId: slot.session.id,
    };
  } finally {
    closeSession(slot.session.id);
  }
}

export function vpsStats() {
  const targets = listVps();
  return {
    total: targets.length,
    online: targets.filter((t) => t.status === "online").length,
    offline: targets.filter((t) => t.status === "offline").length,
    error: targets.filter((t) => t.status === "error").length,
    sshCredentials: listCredentials({ service: "ssh" }).length,
  };
}
