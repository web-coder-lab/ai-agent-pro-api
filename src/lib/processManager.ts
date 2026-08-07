/**
 * Phase 13 — Run & Process Manager
 * Start / stop / list long-running processes in the workspace
 */

import { spawn, type ChildProcess } from "child_process";
import { WORKSPACE } from "./codeRunner.js";
import { log } from "./logger.js";
import { registerPort, unregisterPort } from "./preview.js";
import { randomUUID } from "crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

export type ProcInfo = {
  id: string;
  name: string;
  command: string;
  args: string[];
  pid: number | null;
  cwd: string;
  status: "running" | "exited" | "killed" | "error";
  exitCode: number | null;
  startedAt: string;
  exitedAt?: string;
  port?: number;
  logFile?: string;
};

type Internal = ProcInfo & { child?: ChildProcess };

const procs = new Map<string, Internal>();
const LOG_DIR = join("/tmp", "ai-agent-pro-proc-logs");
mkdirSync(LOG_DIR, { recursive: true });

export function listProcesses(): ProcInfo[] {
  return [...procs.values()].map(publicInfo);
}

function publicInfo(p: Internal): ProcInfo {
  const { child, ...rest } = p;
  return { ...rest };
}

export function getProcess(id: string): ProcInfo | null {
  const p = procs.get(id);
  return p ? publicInfo(p) : null;
}

export async function startProcess(opts: {
  name?: string;
  command: string;
  args?: string[];
  cwd?: string;
  port?: number;
  env?: Record<string, string>;
}): Promise<ProcInfo> {
  const id = randomUUID().slice(0, 10);
  const cwd = opts.cwd && opts.cwd.startsWith(WORKSPACE) ? opts.cwd : WORKSPACE;
  const args = opts.args || [];
  // Allow "npm start" style by running via bash -lc when no args and command has spaces
  let file = opts.command;
  let spawnArgs = args;
  if (!args.length && /\s/.test(opts.command)) {
    file = "bash";
    spawnArgs = ["-lc", opts.command];
  }

  const logFile = join(LOG_DIR, `${id}.log`);
  const logStream = createWriteStream(logFile, { flags: "a" });

  const info: Internal = {
    id,
    name: opts.name || opts.command.slice(0, 40),
    command: opts.command,
    args: spawnArgs,
    pid: null,
    cwd,
    status: "running",
    exitCode: null,
    startedAt: new Date().toISOString(),
    port: opts.port,
    logFile,
  };

  try {
    const child = spawn(file, spawnArgs, {
      cwd,
      env: { ...process.env, ...opts.env, HOME: WORKSPACE },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
    info.child = child;
    info.pid = child.pid ?? null;
    procs.set(id, info);

    child.stdout?.on("data", (d) => {
      logStream.write(d);
    });
    child.stderr?.on("data", (d) => {
      logStream.write(d);
    });
    child.on("close", (code) => {
      info.status = code === 0 ? "exited" : "exited";
      info.exitCode = code;
      info.exitedAt = new Date().toISOString();
      logStream.end();
      if (info.port) unregisterPort(info.port);
      log("info", `Process ${info.name} exited code=${code}`, "process");
    });
    child.on("error", (err) => {
      info.status = "error";
      info.exitCode = 1;
      info.exitedAt = new Date().toISOString();
      logStream.write(String(err.message));
      logStream.end();
      log("error", `Process ${info.name} error: ${err.message}`, "process");
    });

    if (opts.port) registerPort(opts.port, info.name);
    log("info", `Started process ${info.name} pid=${info.pid}`, "process");
    return publicInfo(info);
  } catch (e: any) {
    info.status = "error";
    info.exitCode = 1;
    info.exitedAt = new Date().toISOString();
    procs.set(id, info);
    throw e;
  }
}

export function stopProcess(id: string, signal: NodeJS.Signals = "SIGTERM"): ProcInfo | null {
  const p = procs.get(id);
  if (!p) return null;
  if (p.child && p.status === "running") {
    try {
      p.child.kill(signal);
      // force kill after 3s
      setTimeout(() => {
        if (p.status === "running" && p.child) {
          try { p.child.kill("SIGKILL"); } catch {}
        }
      }, 3000);
      p.status = "killed";
      p.exitedAt = new Date().toISOString();
      if (p.port) unregisterPort(p.port);
      log("info", `Stopped process ${p.name}`, "process");
    } catch (e: any) {
      log("error", `Stop failed: ${e.message}`, "process");
    }
  }
  return publicInfo(p);
}

export function stopAll(): number {
  let n = 0;
  for (const id of [...procs.keys()]) {
    const p = procs.get(id);
    if (p?.status === "running") {
      stopProcess(id);
      n++;
    }
  }
  return n;
}

export function readProcessLog(id: string, tail = 200): string {
  const p = procs.get(id);
  if (!p?.logFile || !existsSync(p.logFile)) return "";
  try {
    const data = readFileSync(p.logFile, "utf8");
    const lines = data.split("\n");
    return lines.slice(-tail).join("\n");
  } catch {
    return "";
  }
}

/** Preset runners */
export function startPreset(preset: string): Promise<ProcInfo> {
  const map: Record<string, { command: string; name: string; port?: number }> = {
    "static-preview": {
      name: "static-preview",
      command: "python3 -m http.server 5500 --bind 127.0.0.1",
      port: 5500,
    },
    "node-http": {
      name: "node-http",
      command: `node -e "require('http').createServer((q,s)=>s.end('ok')).listen(5501,'127.0.0.1')"`,
      port: 5501,
    },
  };
  const p = map[preset];
  if (!p) return Promise.reject(new Error(`Unknown preset: ${preset}`));
  return startProcess(p);
}
