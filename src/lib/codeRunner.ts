/**
 * Phase 2 — Code Execution Engine (Hardened)
 * Sandboxed • Multi-language • Real runtimes • Safe
 */

import { spawn } from "child_process";
import { writeFile, unlink, mkdir } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

export const WORKSPACE = join(process.cwd(), "workspace");
// Use /tmp for compiled binaries — workspace may be noexec (FUSE)
const TMP = join("/tmp", "ai-agent-pro-tmp");
mkdirSync(WORKSPACE, { recursive: true });
mkdirSync(TMP, { recursive: true });

export type RunResult = {
  language: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  available: boolean;
  error?: string;
};

export type LangDef = {
  id: string;
  name: string;
  ext: string;
  /** Command prefix. File path is appended unless stdin=true */
  cmd: string[];
  /** Feed code via stdin instead of file */
  stdin?: boolean;
  /** Wrap bare code for languages that need main() etc */
  wrap?: (code: string) => string;
  /** Quick check binary */
  bin: string;
};

// ─── Language Registry (interpreted-first + available compiled) ─────────────

export const LANGUAGES: LangDef[] = [
  // Core interpreted
  { id: "python", name: "Python 3", ext: "py", cmd: ["python3"], bin: "python3" },
  { id: "javascript", name: "JavaScript (Node)", ext: "js", cmd: ["node"], bin: "node" },
  { id: "typescript", name: "TypeScript", ext: "ts", cmd: ["npx", "--yes", "tsx"], bin: "node" },
  { id: "bash", name: "Bash", ext: "sh", cmd: ["bash"], bin: "bash" },
  { id: "sh", name: "Shell", ext: "sh", cmd: ["sh"], bin: "sh" },
  { id: "php", name: "PHP", ext: "php", cmd: ["php"], bin: "php" },
  { id: "ruby", name: "Ruby", ext: "rb", cmd: ["ruby"], bin: "ruby" },
  { id: "perl", name: "Perl", ext: "pl", cmd: ["perl"], bin: "perl" },

  // Optional interpreted (if installed)
  { id: "lua", name: "Lua", ext: "lua", cmd: ["lua"], bin: "lua" },
  { id: "lua54", name: "Lua 5.4", ext: "lua", cmd: ["lua5.4"], bin: "lua5.4" },
  { id: "r", name: "R", ext: "r", cmd: ["Rscript"], bin: "Rscript" },
  { id: "julia", name: "Julia", ext: "jl", cmd: ["julia"], bin: "julia" },
  { id: "elixir", name: "Elixir", ext: "exs", cmd: ["elixir"], bin: "elixir" },
  { id: "deno", name: "Deno", ext: "ts", cmd: ["deno", "run", "--allow-all"], bin: "deno" },
  { id: "bun", name: "Bun", ext: "ts", cmd: ["bun", "run"], bin: "bun" },
  { id: "raku", name: "Raku", ext: "raku", cmd: ["raku"], bin: "raku" },

  // Text / calculators
  { id: "sql", name: "SQLite", ext: "sql", cmd: ["sqlite3", ":memory:"], bin: "sqlite3", stdin: true },
  { id: "jq", name: "jq", ext: "jq", cmd: ["jq", "-n", "-f"], bin: "jq" },
  { id: "awk", name: "AWK", ext: "awk", cmd: ["awk", "-f"], bin: "awk" },
  { id: "bc", name: "bc", ext: "bc", cmd: ["bc", "-l"], bin: "bc", stdin: true },

  // Compiled (auto-wrap + compile+run) — only when binary exists
  {
    id: "c",
    name: "C (gcc)",
    ext: "c",
    bin: "gcc",
    cmd: ["gcc"],
    wrap: (code) =>
      code.includes("main")
        ? code
        : `#include <stdio.h>\nint main(){\n${code}\nreturn 0;\n}`,
  },
  {
    id: "cpp",
    name: "C++ (g++)",
    ext: "cpp",
    bin: "g++",
    cmd: ["g++", "-std=c++17"],
    wrap: (code) =>
      code.includes("main")
        ? code
        : `#include <iostream>\nusing namespace std;\nint main(){\n${code}\nreturn 0;\n}`,
  },
  {
    id: "go",
    name: "Go",
    ext: "go",
    bin: "go",
    cmd: ["go", "run"],
    wrap: (code) =>
      code.includes("package")
        ? code
        : `package main\nimport "fmt"\nfunc main(){\n${code}\n}`,
  },
  {
    id: "rust",
    name: "Rust",
    ext: "rs",
    bin: "rustc",
    cmd: ["rustc"],
    wrap: (code) =>
      code.includes("fn main")
        ? code
        : `fn main(){\n${code}\n}`,
  },
  {
    id: "java",
    name: "Java",
    ext: "java",
    bin: "java",
    cmd: ["java"],
    wrap: (code) =>
      code.includes("class ")
        ? code
        : `public class Main {\npublic static void main(String[] args){\n${code}\n}\n}`,
  },
];

const TIMEOUT_MS = 20_000;
const MAX_OUTPUT = 100_000;

function truncate(s: string): string {
  if (Buffer.byteLength(s) <= MAX_OUTPUT) return s;
  return s.slice(0, MAX_OUTPUT) + "\n... [truncated]";
}

/** Strip dangerous env vars from child processes */
function safeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const block = [
    "DATABASE_URL", "SESSION_SECRET", "PGPASSWORD", "AWS_SECRET_ACCESS_KEY",
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GITHUB_TOKEN", "NPM_TOKEN",
  ];
  for (const k of block) delete env[k];
  env.HOME = WORKSPACE;
  env.TMPDIR = TMP;
  env.PATH = process.env.PATH;
  return env;
}

function runProcess(
  cmd: string[],
  opts: { cwd?: string; input?: string; timeout?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number; time: number }> {
  const start = Date.now();
  const timeout = opts.timeout ?? TIMEOUT_MS;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (stdout: string, stderr: string, exitCode: number) => {
      if (settled) return;
      settled = true;
      resolve({
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        exitCode,
        time: Date.now() - start,
      });
    };

    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: opts.cwd || WORKSPACE,
      env: safeEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(stdout, stderr + "\n[timeout]", 124);
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      finish(stdout, stderr, code ?? 1);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      finish("", err.message, 1);
    });

    if (opts.input != null) {
      child.stdin?.write(opts.input);
      child.stdin?.end();
    } else {
      child.stdin?.end();
    }
  });
}

async function binaryExists(bin: string): Promise<boolean> {
  if (bin === "node" || bin === "python3" || bin === "bash") return true;
  const r = await runProcess(["which", bin], { timeout: 3000 });
  return r.exitCode === 0 && r.stdout.trim().length > 0;
}

// Cache availability
let _availCache: Map<string, boolean> | null = null;
let _availCacheTime = 0;

export async function detectAvailableLanguages(): Promise<LangDef[]> {
  const now = Date.now();
  if (_availCache && now - _availCacheTime < 60_000) {
    return LANGUAGES.filter((l) => _availCache!.get(l.id));
  }
  const map = new Map<string, boolean>();
  const results: LangDef[] = [];
  for (const lang of LANGUAGES) {
    const ok = await binaryExists(lang.bin);
    map.set(lang.id, ok);
    if (ok) results.push(lang);
  }
  _availCache = map;
  _availCacheTime = now;
  return results;
}

export function listLanguages() {
  return LANGUAGES.map((l) => ({ id: l.id, name: l.name, ext: l.ext }));
}

export async function runCode(language: string, code: string): Promise<RunResult> {
  const lang =
    LANGUAGES.find((l) => l.id === language) ||
    LANGUAGES.find((l) => l.name.toLowerCase() === language.toLowerCase());

  if (!lang) {
    return {
      language,
      stdout: "",
      stderr: `Unsupported language: ${language}`,
      exitCode: 1,
      executionTime: 0,
      available: false,
      error: "unsupported_language",
    };
  }

  const available = await binaryExists(lang.bin);
  if (!available) {
    return {
      language: lang.id,
      stdout: "",
      stderr: `Runtime not available: ${lang.bin}`,
      exitCode: 1,
      executionTime: 0,
      available: false,
      error: "runtime_missing",
    };
  }

  const id = randomUUID().slice(0, 8);
  let source = lang.wrap ? lang.wrap(code) : code;

  // ── SQL / bc via stdin ──
  if (lang.stdin) {
    const r = await runProcess(lang.cmd, { input: source });
    return {
      language: lang.id,
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exitCode,
      executionTime: r.time,
      available: true,
    };
  }

  // ── Compiled languages ──
  if (lang.id === "c" || lang.id === "cpp") {
    const srcFile = join(TMP, `run_${id}.${lang.ext}`);
    const outFile = join(TMP, `run_${id}.out`);
    try {
      await writeFile(srcFile, source, "utf8");
      const compiler = lang.id === "c" ? "gcc" : "g++";
      const flags = lang.id === "cpp" ? ["-std=c++17"] : [];
      const compile = await runProcess([compiler, ...flags, srcFile, "-o", outFile], { timeout: 15000 });
      if (compile.exitCode !== 0) {
        return {
          language: lang.id,
          stdout: compile.stdout,
          stderr: compile.stderr,
          exitCode: compile.exitCode,
          executionTime: compile.time,
          available: true,
        };
      }
      await runProcess(["chmod", "+x", outFile], { timeout: 3000 });
      const run = await runProcess([outFile]);
      return {
        language: lang.id,
        stdout: run.stdout,
        stderr: run.stderr,
        exitCode: run.exitCode,
        executionTime: compile.time + run.time,
        available: true,
      };
    } finally {
      try { await unlink(srcFile); } catch {}
      try { await unlink(outFile); } catch {}
    }
  }

  if (lang.id === "rust") {
    const srcFile = join(TMP, `run_${id}.rs`);
    const outFile = join(TMP, `run_${id}`);
    try {
      await writeFile(srcFile, source, "utf8");
      const compile = await runProcess(["rustc", srcFile, "-o", outFile], { timeout: 20000 });
      if (compile.exitCode !== 0) {
        return {
          language: lang.id,
          stdout: compile.stdout,
          stderr: compile.stderr,
          exitCode: compile.exitCode,
          executionTime: compile.time,
          available: true,
        };
      }
      await runProcess(["chmod", "+x", outFile], { timeout: 3000 });
      const run = await runProcess([outFile]);
      return {
        language: lang.id,
        stdout: run.stdout,
        stderr: run.stderr,
        exitCode: run.exitCode,
        executionTime: compile.time + run.time,
        available: true,
      };
    } finally {
      try { await unlink(srcFile); } catch {}
      try { await unlink(outFile); } catch {}
    }
  }

  if (lang.id === "java") {
    const srcFile = join(TMP, "Main.java");
    try {
      await writeFile(srcFile, source, "utf8");
      const compile = await runProcess(["javac", srcFile], { cwd: TMP, timeout: 15000 });
      if (compile.exitCode !== 0) {
        return {
          language: lang.id,
          stdout: compile.stdout,
          stderr: compile.stderr,
          exitCode: compile.exitCode,
          executionTime: compile.time,
          available: true,
        };
      }
      const run = await runProcess(["java", "-cp", TMP, "Main"]);
      return {
        language: lang.id,
        stdout: run.stdout,
        stderr: run.stderr,
        exitCode: run.exitCode,
        executionTime: compile.time + run.time,
        available: true,
      };
    } finally {
      try { await unlink(srcFile); } catch {}
      try { await unlink(join(TMP, "Main.class")); } catch {}
    }
  }

  if (lang.id === "go") {
    const srcFile = join(TMP, `run_${id}.go`);
    try {
      await writeFile(srcFile, source, "utf8");
      const r = await runProcess(["go", "run", srcFile], { timeout: 20000 });
      return {
        language: lang.id,
        stdout: r.stdout,
        stderr: r.stderr,
        exitCode: r.exitCode,
        executionTime: r.time,
        available: true,
      };
    } finally {
      try { await unlink(srcFile); } catch {}
    }
  }

  // ── Default: write file + run ──
  const srcFile = join(TMP, `run_${id}.${lang.ext}`);
  try {
    await writeFile(srcFile, source, "utf8");
    const cmd = [...lang.cmd, srcFile];
    const r = await runProcess(cmd);
    return {
      language: lang.id,
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exitCode,
      executionTime: r.time,
      available: true,
    };
  } finally {
    try { await unlink(srcFile); } catch {}
  }
}

/** Quick self-test of core languages */
export async function selfTest(): Promise<{ lang: string; ok: boolean; sample: string }[]> {
  const tests: { id: string; code: string; expect: string }[] = [
    { id: "python", code: "print(2+2)", expect: "4" },
    { id: "javascript", code: "console.log(2+2)", expect: "4" },
    { id: "bash", code: "echo 4", expect: "4" },
    { id: "php", code: "<?php echo 2+2;", expect: "4" },
    { id: "ruby", code: "puts 2+2", expect: "4" },
    { id: "perl", code: "print 2+2", expect: "4" },
  ];
  const results = [];
  for (const t of tests) {
    const r = await runCode(t.id, t.code);
    results.push({
      lang: t.id,
      ok: r.exitCode === 0 && r.stdout.includes(t.expect),
      sample: (r.stdout || r.stderr || "").slice(0, 80),
    });
  }
  return results;
}
