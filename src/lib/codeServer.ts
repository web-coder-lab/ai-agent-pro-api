/**
 * Phase 29 — code-server Controller
 * Start/stop/status code-server against workspace; extension helpers; graceful if missing.
 */

import { spawn, execFile, execFileSync, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { WORKSPACE } from "./codeRunner.js";
import { log } from "./logger.js";
import { registerPort, unregisterPort } from "./preview.js";
import { createCheckpoint } from "./patchEngine.js";
import { writeWorkspaceFile, readWorkspaceFile } from "./fileManager.js";

const DATA = join(process.cwd(), ".data");
const STATE_FILE = join(DATA, "code-server.json");
mkdirSync(DATA, { recursive: true });

export type CodeServerState = {
  running: boolean;
  pid?: number;
  port: number;
  host: string;
  workspace: string;
  url?: string;
  password?: string;
  startedAt?: string;
  lastError?: string;
  binary?: string;
};

let child: ChildProcess | null = null;
let state: CodeServerState = loadState();

function loadState(): CodeServerState {
  if (existsSync(STATE_FILE)) {
    try {
      return { ...JSON.parse(readFileSync(STATE_FILE, "utf8")), running: false };
    } catch {
      /* fallthrough */
    }
  }
  return {
    running: false,
    port: 8080,
    host: "127.0.0.1",
    workspace: WORKSPACE,
  };
}

function saveState() {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Locate code-server binary */
export function findCodeServerBinary(): string | null {
  const candidates = [
    "code-server",
    join(process.env.HOME || "/root", ".local/bin/code-server"),
    "/usr/bin/code-server",
    "/usr/local/bin/code-server",
  ];
  for (const c of candidates) {
    try {
      if (c === "code-server") {
        // which via command
        continue;
      }
      if (existsSync(c)) return c;
    } catch {
      /* */
    }
  }
  // try `which` synchronously via spawn sync alternative
  try {
    const out = execFileSync("which", ["code-server"], { encoding: "utf8" }).trim();
    if (out) return out;
  } catch {
    /* not installed */
  }
  return null;
}

export function getCodeServerStatus(): CodeServerState & { installed: boolean } {
  const binary = findCodeServerBinary();
  // refresh running flag from child
  if (child && child.exitCode === null && !child.killed) {
    state.running = true;
    state.pid = child.pid;
  } else if (state.running && (!child || child.killed)) {
    state.running = false;
    state.pid = undefined;
  }
  return {
    ...state,
    binary: binary || undefined,
    installed: !!binary,
    url: state.running ? `http://${state.host}:${state.port}` : undefined,
  };
}

export async function startCodeServer(opts?: {
  port?: number;
  password?: string;
  workspace?: string;
}): Promise<CodeServerState & { installed: boolean }> {
  const binary = findCodeServerBinary();
  if (!binary) {
    state.lastError =
      "code-server not installed. Install: curl -fsSL https://code-server.dev/install.sh | sh";
    saveState();
    log("warn", state.lastError, "code-server");
    return getCodeServerStatus();
  }

  if (state.running && child && !child.killed) {
    return getCodeServerStatus();
  }

  const port = opts?.port || state.port || 8080;
  const host = "127.0.0.1";
  const workspace = opts?.workspace || WORKSPACE;
  const password = opts?.password || state.password || randomPass();

  const userDataDir = join(DATA, "code-server-user");
  mkdirSync(userDataDir, { recursive: true });

  const args = [
    "--bind-addr",
    `${host}:${port}`,
    "--auth",
    "password",
    "--disable-telemetry",
    "--user-data-dir",
    userDataDir,
    workspace,
  ];

  try {
    child = spawn(binary, args, {
      env: {
        ...process.env,
        PASSWORD: password,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    state = {
      running: true,
      pid: child.pid,
      port,
      host,
      workspace,
      password,
      startedAt: new Date().toISOString(),
      binary,
      url: `http://${host}:${port}`,
    };
    saveState();
    registerPort(port, "code-server");

    child.stdout?.on("data", (d) => log("debug", String(d).slice(0, 200), "code-server"));
    child.stderr?.on("data", (d) => log("debug", String(d).slice(0, 200), "code-server"));
    child.on("exit", (code) => {
      log("info", `code-server exited ${code}`, "code-server");
      state.running = false;
      state.pid = undefined;
      unregisterPort(port);
      saveState();
      child = null;
    });

    log("info", `code-server starting on ${host}:${port}`, "code-server");
  } catch (e: any) {
    state.running = false;
    state.lastError = e.message;
    saveState();
  }

  return getCodeServerStatus();
}

export function stopCodeServer(): CodeServerState & { installed: boolean } {
  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child && !child.killed) child.kill("SIGKILL");
      }, 3000);
    } catch (e: any) {
      state.lastError = e.message;
    }
  }
  if (state.port) unregisterPort(state.port);
  state.running = false;
  state.pid = undefined;
  saveState();
  child = null;
  log("info", "code-server stopped", "code-server");
  return getCodeServerStatus();
}

function randomPass() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

/** Install extension via code-server CLI when available */
export function installExtension(extId: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const binary = findCodeServerBinary();
    if (!binary) {
      resolve({ ok: false, output: "code-server not installed" });
      return;
    }
    execFile(binary, ["--install-extension", extId], { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, output: stderr || err.message });
      else resolve({ ok: true, output: stdout || "installed" });
    });
  });
}

export function listExtensions(): Promise<{ ok: boolean; extensions: string[]; output?: string }> {
  return new Promise((resolve) => {
    const binary = findCodeServerBinary();
    if (!binary) {
      resolve({ ok: false, extensions: [], output: "code-server not installed" });
      return;
    }
    execFile(binary, ["--list-extensions"], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, extensions: [], output: stderr || err.message });
      else
        resolve({
          ok: true,
          extensions: stdout.split("\n").map((s) => s.trim()).filter(Boolean),
        });
    });
  });
}

/**
 * Apply a file edit with automatic checkpoint (works with or without code-server).
 * This is the AI "edit in workspace / open in IDE" path.
 */
export async function ideWriteFile(
  path: string,
  content: string,
  opts?: { checkpoint?: boolean }
): Promise<{ ok: boolean; path: string; checkpointId?: string }> {
  let checkpointId: string | undefined;
  if (opts?.checkpoint !== false) {
    try {
      const cp = await createCheckpoint(`ide-write-${path}`);
      checkpointId = cp.id;
    } catch {
      /* non-fatal */
    }
  }
  await writeWorkspaceFile(path, content);
  log("info", `IDE write ${path}`, "code-server");
  return { ok: true, path, checkpointId };
}

export async function ideReadFile(path: string) {
  return readWorkspaceFile(path);
}

export function installInstructions() {
  return {
    linux: "curl -fsSL https://code-server.dev/install.sh | sh",
    mac: "brew install code-server",
    npm: "npm install -g code-server",
    note: "After install, use POST /api/code-server/start",
  };
}
