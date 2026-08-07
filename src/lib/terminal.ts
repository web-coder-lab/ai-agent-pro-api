/**
 * Phase 11 — Integrated Terminal (session + command runner)
 * Note: full interactive PTY needs node-pty; this is a reliable cwd-aware shell session.
 */

import { spawn } from "child_process";
import { WORKSPACE } from "./codeRunner.js";
import { log } from "./logger.js";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { resolve, join } from "path";

export type TermSession = {
  id: string;
  cwd: string;
  createdAt: string;
  lastCommand?: string;
};

const sessions = new Map<string, TermSession>();

function safeCwd(cwd: string): string {
  const resolved = resolve(cwd);
  if (!resolved.startsWith(WORKSPACE)) return WORKSPACE;
  if (!existsSync(resolved)) return WORKSPACE;
  return resolved;
}

export function createSession(): TermSession {
  const s: TermSession = {
    id: randomUUID().slice(0, 12),
    cwd: WORKSPACE,
    createdAt: new Date().toISOString(),
  };
  sessions.set(s.id, s);
  log("info", `Terminal session ${s.id}`, "terminal");
  return s;
}

export function getSession(id: string): TermSession | null {
  return sessions.get(id) || null;
}

export function listSessions(): TermSession[] {
  return [...sessions.values()];
}

export function destroySession(id: string): boolean {
  return sessions.delete(id);
}

export type ExecResult = {
  sessionId: string;
  cwd: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  time: number;
};

export async function execInSession(
  sessionId: string,
  command: string,
  timeoutMs = 30000
): Promise<ExecResult> {
  let session = sessions.get(sessionId);
  if (!session) {
    session = createSession();
    sessionId = session.id;
  }

  const cmd = (command || "").trim();
  if (!cmd) {
    return {
      sessionId,
      cwd: session.cwd,
      command: cmd,
      stdout: "",
      stderr: "empty command",
      exitCode: 1,
      time: 0,
    };
  }

  // Handle cd specially to persist cwd
  if (cmd === "cd" || cmd.startsWith("cd ")) {
    const arg = cmd === "cd" ? WORKSPACE : cmd.slice(3).trim().replace(/^["']|["']$/g, "");
    const next = arg.startsWith("/")
      ? safeCwd(arg.startsWith(WORKSPACE) ? arg : join(WORKSPACE, arg.replace(/^\//, "")))
      : safeCwd(resolve(session.cwd, arg || "."));
    session.cwd = next;
    session.lastCommand = cmd;
    return {
      sessionId,
      cwd: session.cwd,
      command: cmd,
      stdout: "",
      stderr: "",
      exitCode: 0,
      time: 0,
    };
  }

  if (cmd === "pwd") {
    return {
      sessionId,
      cwd: session.cwd,
      command: cmd,
      stdout: session.cwd + "\n",
      stderr: "",
      exitCode: 0,
      time: 0,
    };
  }

  // Block destructive patterns
  if (/\brm\s+(-[a-zA-Z]*f\s+)?\/($|\s)|mkfs|dd\s+if=|:(){:|:&};:/.test(cmd)) {
    return {
      sessionId,
      cwd: session.cwd,
      command: cmd,
      stdout: "",
      stderr: "Command blocked for safety\n",
      exitCode: 1,
      time: 0,
    };
  }

  const start = Date.now();
  const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolveP) => {
    const child = spawn("bash", ["-lc", cmd], {
      cwd: session!.cwd,
      env: {
        ...process.env,
        HOME: WORKSPACE,
        TERM: "xterm-256color",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolveP({ stdout, stderr: stderr + "\n[timeout]\n", exitCode: 124 });
    }, timeoutMs);
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
      resolveP({ stdout, stderr, exitCode: code ?? 1 });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolveP({ stdout: "", stderr: err.message, exitCode: 1 });
    });
  });

  // Detect cd inside compound commands (best-effort: `cd x && ...` already runs in subshell — cwd won't persist; ok)
  session.lastCommand = cmd;
  log("info", `$ ${cmd} → ${result.exitCode}`, "terminal");

  return {
    sessionId,
    cwd: session.cwd,
    command: cmd,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    time: Date.now() - start,
  };
}
