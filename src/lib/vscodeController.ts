/**
 * Phase 30 — VS Code / code-server Extension & Settings Controller
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { WORKSPACE } from "./codeRunner.js";
import { findCodeServerBinary } from "./codeServer.js";
import { createCheckpoint } from "./patchEngine.js";
import { log } from "./logger.js";

const VSCODE_DIR = join(WORKSPACE, ".vscode");

function ensureVscodeDir() {
  mkdirSync(VSCODE_DIR, { recursive: true });
}

function readJson(path: string, fallback: any = {}) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path: string, data: any) {
  ensureVscodeDir();
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function deepMerge(target: any, patch: any): any {
  if (Array.isArray(patch)) return patch.slice();
  if (patch && typeof patch === "object") {
    const out = { ...(target && typeof target === "object" ? target : {}) };
    for (const k of Object.keys(patch)) {
      out[k] = deepMerge(out[k], patch[k]);
    }
    return out;
  }
  return patch;
}

function runCodeServer(args: string[], timeout = 120000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const bin = findCodeServerBinary();
    if (!bin) {
      resolve({ ok: false, stdout: "", stderr: "code-server not installed" });
      return;
    }
    execFile(bin, args, { timeout }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, stdout: String(stdout || ""), stderr: String(stderr || err.message) });
      else resolve({ ok: true, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

// ── Extensions ────────────────────────────────────────────────

export async function listExtensions(): Promise<{ ok: boolean; extensions: string[]; error?: string }> {
  const r = await runCodeServer(["--list-extensions"], 30000);
  if (!r.ok) return { ok: false, extensions: [], error: r.stderr };
  return {
    ok: true,
    extensions: r.stdout.split("\n").map((s) => s.trim()).filter(Boolean),
  };
}

export async function installExtension(id: string) {
  if (!id?.trim()) throw new Error("extension id required");
  const r = await runCodeServer(["--install-extension", id.trim()]);
  log("info", `install extension ${id}: ${r.ok}`, "vscode");
  return { ok: r.ok, id, output: r.stdout || r.stderr };
}

export async function uninstallExtension(id: string) {
  if (!id?.trim()) throw new Error("extension id required");
  const r = await runCodeServer(["--uninstall-extension", id.trim()]);
  return { ok: r.ok, id, output: r.stdout || r.stderr };
}

export function getRecommendedExtensions() {
  const path = join(VSCODE_DIR, "extensions.json");
  return readJson(path, { recommendations: [] });
}

export function setRecommendedExtensions(ids: string[]) {
  const path = join(VSCODE_DIR, "extensions.json");
  const data = { recommendations: ids };
  writeJson(path, data);
  return data;
}

// ── Settings ──────────────────────────────────────────────────

export function getSettings() {
  const path = join(VSCODE_DIR, "settings.json");
  return readJson(path, {});
}

export async function mergeSettings(patch: Record<string, any>, opts?: { checkpoint?: boolean }) {
  if (!patch || typeof patch !== "object") throw new Error("patch object required");
  if (opts?.checkpoint !== false) {
    try {
      await createCheckpoint("vscode-settings");
    } catch {
      /* */
    }
  }
  const path = join(VSCODE_DIR, "settings.json");
  const current = readJson(path, {});
  const next = deepMerge(current, patch);
  writeJson(path, next);
  log("info", "settings merged", "vscode");
  return next;
}

// ── Profiles ──────────────────────────────────────────────────

export type VscodeProfile = {
  name: string;
  description: string;
  extensions: string[];
  settings: Record<string, any>;
};

const PROFILES: VscodeProfile[] = [
  {
    name: "web-prettier",
    description: "Prettier + format on save + dark theme",
    extensions: ["esbenp.prettier-vscode", "dbaeumer.vscode-eslint"],
    settings: {
      "editor.formatOnSave": true,
      "editor.defaultFormatter": "esbenp.prettier-vscode",
      "workbench.colorTheme": "Default Dark Modern",
    },
  },
  {
    name: "python-black",
    description: "Python + Black formatter",
    extensions: ["ms-python.python", "ms-python.black-formatter"],
    settings: {
      "editor.formatOnSave": true,
      "python.defaultInterpreterPath": "python3",
      "[python]": { "editor.defaultFormatter": "ms-python.black-formatter" },
      "workbench.colorTheme": "Default Dark Modern",
    },
  },
  {
    name: "minimal",
    description: "Format on save + dark theme only",
    extensions: [],
    settings: {
      "editor.formatOnSave": true,
      "workbench.colorTheme": "Default Dark Modern",
      "editor.tabSize": 2,
    },
  },
];

export function listProfiles() {
  return PROFILES.map((p) => ({
    name: p.name,
    description: p.description,
    extensions: p.extensions,
  }));
}

export async function applyProfile(name: string) {
  const profile = PROFILES.find((p) => p.name === name);
  if (!profile) throw new Error(`Unknown profile: ${name}`);

  await mergeSettings(profile.settings);

  const rec = getRecommendedExtensions();
  const set = new Set([...(rec.recommendations || []), ...profile.extensions]);
  setRecommendedExtensions([...set]);

  const extResults = [];
  for (const id of profile.extensions) {
    extResults.push(await installExtension(id));
  }

  log("info", `profile applied: ${name}`, "vscode");
  return {
    profile: profile.name,
    settings: getSettings(),
    extensions: extResults,
    recommendations: [...set],
  };
}

// ── Launch / Tasks ────────────────────────────────────────────

export function getLaunch() {
  return readJson(join(VSCODE_DIR, "launch.json"), {
    version: "0.2.0",
    configurations: [],
  });
}

export async function setLaunch(config: any) {
  try {
    await createCheckpoint("vscode-launch");
  } catch {
    /* */
  }
  const path = join(VSCODE_DIR, "launch.json");
  const data =
    config?.version && config?.configurations
      ? config
      : {
          version: "0.2.0",
          configurations: Array.isArray(config) ? config : [config],
        };
  writeJson(path, data);
  return data;
}

export function ensureDefaultLaunch() {
  const current = getLaunch();
  if (current.configurations?.length) return current;
  return setLaunch({
    version: "0.2.0",
    configurations: [
      {
        type: "node",
        request: "launch",
        name: "Launch Node current",
        program: "${file}",
        skipFiles: ["<node_internals>/**"],
      },
      {
        type: "python",
        request: "launch",
        name: "Python: Current File",
        program: "${file}",
        console: "integratedTerminal",
      },
    ],
  });
}

export function getTasks() {
  return readJson(join(VSCODE_DIR, "tasks.json"), {
    version: "2.0.0",
    tasks: [],
  });
}

export async function setTasks(tasksConfig: any) {
  try {
    await createCheckpoint("vscode-tasks");
  } catch {
    /* */
  }
  const path = join(VSCODE_DIR, "tasks.json");
  const data =
    tasksConfig?.version && tasksConfig?.tasks
      ? tasksConfig
      : { version: "2.0.0", tasks: Array.isArray(tasksConfig) ? tasksConfig : [tasksConfig] };
  writeJson(path, data);
  return data;
}

export function status() {
  return {
    vscodeDir: VSCODE_DIR,
    hasSettings: existsSync(join(VSCODE_DIR, "settings.json")),
    hasLaunch: existsSync(join(VSCODE_DIR, "launch.json")),
    hasTasks: existsSync(join(VSCODE_DIR, "tasks.json")),
    hasExtensionsJson: existsSync(join(VSCODE_DIR, "extensions.json")),
    codeServerBinary: !!findCodeServerBinary(),
    profiles: listProfiles().map((p) => p.name),
  };
}
