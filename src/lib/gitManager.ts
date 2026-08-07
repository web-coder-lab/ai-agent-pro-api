/**
 * Phase 15 — Git + Diff helpers (workspace-scoped)
 */

import { spawn } from "child_process";
import { WORKSPACE } from "./codeRunner.js";
import { log } from "./logger.js";
import { existsSync } from "fs";
import { join } from "path";

function runGit(args: string[], cwd = WORKSPACE): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      env: {
        ...process.env,
        HOME: WORKSPACE,
        GIT_TERMINAL_PROMPT: "0",
        // FUSE workspaces sometimes break .git/index locks — keep index in /tmp
        GIT_INDEX_FILE: join("/tmp", "ai-agent-pro-git-index"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: 124, stdout, stderr: stderr + "\n[timeout]" });
    }, 30000);
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(t);
      resolve({ code: 1, stdout: "", stderr: err.message });
    });
  });
}

export async function isGitRepo(cwd = WORKSPACE): Promise<boolean> {
  const r = await runGit(["rev-parse", "--is-inside-work-tree"], cwd);
  return r.code === 0 && r.stdout.trim() === "true";
}

export async function gitInit(cwd = WORKSPACE): Promise<{ ok: boolean; message: string }> {
  if (await isGitRepo(cwd)) return { ok: true, message: "already a git repo" };
  const r = await runGit(["init"], cwd);
  if (r.code !== 0) return { ok: false, message: r.stderr || r.stdout };
  // minimal identity for local commits
  await runGit(["config", "user.email", "agent@localhost"], cwd);
  await runGit(["config", "user.name", "AI Agent Pro"], cwd);
  log("info", "git init", "git");
  return { ok: true, message: "initialized" };
}

export async function gitStatus(cwd = WORKSPACE) {
  const repo = await isGitRepo(cwd);
  if (!repo) return { repo: false, branch: null, porcelain: "", files: [] as any[] };

  const [branchR, porcR] = await Promise.all([
    runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    runGit(["status", "--porcelain=1", "-uall"], cwd),
  ]);

  const files = porcR.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      const path = line.slice(3).trim();
      return { status, path };
    });

  return {
    repo: true,
    branch: branchR.stdout.trim() || null,
    porcelain: porcR.stdout,
    files,
  };
}

export async function gitDiff(opts: { staged?: boolean; path?: string; cwd?: string } = {}) {
  const cwd = opts.cwd || WORKSPACE;
  if (!(await isGitRepo(cwd))) return { repo: false, diff: "" };
  const args = ["diff"];
  if (opts.staged) args.push("--cached");
  args.push("--no-color", "-U3");
  if (opts.path) args.push("--", opts.path);
  const r = await runGit(args, cwd);
  return { repo: true, diff: r.stdout || r.stderr, code: r.code };
}

export async function gitLog(limit = 20, cwd = WORKSPACE) {
  if (!(await isGitRepo(cwd))) return { repo: false, commits: [] };
  const r = await runGit(
    ["log", `-n`, String(limit), "--pretty=format:%H|%h|%an|%ae|%cI|%s"],
    cwd
  );
  const commits = r.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, short, author, email, date, ...rest] = line.split("|");
      return { hash, short, author, email, date, subject: rest.join("|") };
    });
  return { repo: true, commits };
}

export async function gitAdd(paths: string[] = ["."], cwd = WORKSPACE) {
  if (!(await isGitRepo(cwd))) {
    await gitInit(cwd);
  }
  const r = await runGit(["add", "--", ...paths], cwd);
  log("info", `git add ${paths.join(" ")}`, "git");
  return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr };
}

export async function gitCommit(message: string, cwd = WORKSPACE) {
  if (!message?.trim()) return { ok: false, stderr: "message required" };
  if (!(await isGitRepo(cwd))) await gitInit(cwd);
  // ensure identity
  await runGit(["config", "user.email", "agent@localhost"], cwd);
  await runGit(["config", "user.name", "AI Agent Pro"], cwd);
  const r = await runGit(["commit", "-m", message], cwd);
  log("info", `git commit: ${message.slice(0, 60)}`, "git");
  return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr, code: r.code };
}

export async function gitShow(ref = "HEAD", cwd = WORKSPACE) {
  if (!(await isGitRepo(cwd))) return { repo: false, patch: "" };
  const r = await runGit(["show", "--no-color", ref], cwd);
  return { repo: true, patch: r.stdout, code: r.code };
}
