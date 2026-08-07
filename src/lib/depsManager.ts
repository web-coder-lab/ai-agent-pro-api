/**
 * Phase 14 — Dependency Manager
 * Detect manifests + install dependencies in workspace
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { WORKSPACE } from "./codeRunner.js";
import { log } from "./logger.js";

export type ManifestKind =
  | "npm"
  | "pip"
  | "pipenv"
  | "poetry"
  | "go"
  | "cargo"
  | "composer"
  | "unknown";

export type DetectedManifest = {
  kind: ManifestKind;
  file: string;
  path: string;
  meta?: Record<string, any>;
};

export type InstallResult = {
  kind: ManifestKind;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  time: number;
};

function run(cmd: string[], cwd: string, timeoutMs = 120000): Promise<{ code: number; stdout: string; stderr: string; time: number }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd,
      env: { ...process.env, HOME: WORKSPACE, PYTHONUSERBASE: join(WORKSPACE, ".python") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: 124, stdout, stderr: stderr + "\n[timeout]", time: Date.now() - start });
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
      if (stdout.length > 80_000) stdout = stdout.slice(-80_000);
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 40_000) stderr = stderr.slice(-40_000);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, time: Date.now() - start });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout: "", stderr: err.message, time: Date.now() - start });
    });
  });
}

export function detectManifests(cwd = WORKSPACE): DetectedManifest[] {
  const found: DetectedManifest[] = [];
  const checks: { file: string; kind: ManifestKind; parse?: (raw: string) => Record<string, any> }[] = [
    {
      file: "package.json",
      kind: "npm",
      parse: (raw) => {
        try {
          const j = JSON.parse(raw);
          return {
            name: j.name,
            deps: Object.keys(j.dependencies || {}).length,
            devDeps: Object.keys(j.devDependencies || {}).length,
          };
        } catch {
          return {};
        }
      },
    },
    { file: "requirements.txt", kind: "pip" },
    { file: "Pipfile", kind: "pipenv" },
    { file: "pyproject.toml", kind: "poetry" },
    { file: "go.mod", kind: "go" },
    { file: "Cargo.toml", kind: "cargo" },
    { file: "composer.json", kind: "composer" },
  ];

  for (const c of checks) {
    const path = join(cwd, c.file);
    if (!existsSync(path)) continue;
    let meta: Record<string, any> | undefined;
    if (c.parse) {
      try {
        meta = c.parse(readFileSync(path, "utf8"));
      } catch {
        meta = {};
      }
    } else {
      try {
        const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
        meta = { lines: lines.length };
      } catch {
        meta = {};
      }
    }
    found.push({ kind: c.kind, file: c.file, path, meta });
  }
  return found;
}

export async function installDependencies(
  kind?: ManifestKind,
  cwd = WORKSPACE
): Promise<InstallResult> {
  const detected = detectManifests(cwd);
  const target = kind
    ? detected.find((d) => d.kind === kind)
    : detected[0];

  if (!target && !kind) {
    return {
      kind: "unknown",
      command: "",
      exitCode: 1,
      stdout: "",
      stderr: "No dependency manifest found (package.json, requirements.txt, ...)",
      time: 0,
    };
  }

  const k = (target?.kind || kind || "unknown") as ManifestKind;
  const commands: Record<string, string[]> = {
    npm: ["npm", "install", "--no-audit", "--no-fund"],
    pip: ["pip3", "install", "-r", "requirements.txt", "--user"],
    pipenv: ["pipenv", "install"],
    poetry: ["poetry", "install", "--no-root"],
    go: ["go", "mod", "download"],
    cargo: ["cargo", "fetch"],
    composer: ["composer", "install", "--no-interaction"],
  };

  const cmd = commands[k];
  if (!cmd) {
    return {
      kind: k,
      command: "",
      exitCode: 1,
      stdout: "",
      stderr: `Unsupported kind: ${k}`,
      time: 0,
    };
  }

  log("info", `Installing deps via ${k}: ${cmd.join(" ")}`, "deps");
  const r = await run(cmd, cwd);
  log(
    r.code === 0 ? "info" : "error",
    `Deps ${k} exit=${r.code} ${r.time}ms`,
    "deps"
  );

  return {
    kind: k,
    command: cmd.join(" "),
    exitCode: r.code,
    stdout: r.stdout,
    stderr: r.stderr,
    time: r.time,
  };
}

export async function addPackage(
  manager: "npm" | "pip",
  packageName: string,
  cwd = WORKSPACE
): Promise<InstallResult> {
  const cmd =
    manager === "npm"
      ? ["npm", "install", packageName, "--no-audit", "--no-fund"]
      : ["pip3", "install", "--user", packageName];

  log("info", `Add package ${manager}: ${packageName}`, "deps");
  const r = await run(cmd, cwd, 90000);
  return {
    kind: manager === "npm" ? "npm" : "pip",
    command: cmd.join(" "),
    exitCode: r.code,
    stdout: r.stdout,
    stderr: r.stderr,
    time: r.time,
  };
}
