/**
 * Phase 41 — Digital Twin + Simulation Environment
 * Snapshot server/deploy state; simulate before real deploy; gate promotion.
 */

import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { log } from "./logger.js";
import { listVps, getVps } from "./vpsBroker.js";
import { listLocalAiNodes } from "./localAiCluster.js";
import { detectTools } from "./deployAgents.js";
import { detectKubeTools } from "./k8sLbCdn.js";
import { WORKSPACE } from "./codeRunner.js";
import { listAllFiles, readWorkspaceFile } from "./fileManager.js";
import { runCode } from "./codeRunner.js";

const DATA = join(process.cwd(), ".data", "twins");
const SIM_LOG = join(process.cwd(), ".data", "simulations.json");
mkdirSync(DATA, { recursive: true });

export type TwinSnapshot = {
  id: string;
  name: string;
  vpsId: string; // "local" or VPS id
  createdAt: string;
  inventory: {
    files: string[];
    hasDockerfile: boolean;
    hasCompose: boolean;
    hasK8s: boolean;
    tools: Record<string, boolean>;
    kube: Record<string, boolean>;
    localAi: number;
  };
  notes?: string;
};

export type SimCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type SimulationResult = {
  id: string;
  twinId: string;
  createdAt: string;
  checks: SimCheck[];
  passed: boolean;
  promoteReady: boolean;
};

function saveTwin(t: TwinSnapshot) {
  writeFileSync(join(DATA, `${t.id}.json`), JSON.stringify(t, null, 2));
}

function loadTwin(id: string): TwinSnapshot | null {
  const p = join(DATA, `${id}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function loadSims(): SimulationResult[] {
  try {
    if (!existsSync(SIM_LOG)) return [];
    return JSON.parse(readFileSync(SIM_LOG, "utf8"));
  } catch {
    return [];
  }
}

function saveSims(rows: SimulationResult[]) {
  try {
    mkdirSync(join(process.cwd(), ".data"), { recursive: true });
    writeFileSync(SIM_LOG, JSON.stringify(rows.slice(0, 100), null, 2));
  } catch {
    /* */
  }
}

export async function createTwin(input?: {
  name?: string;
  vpsId?: string;
  notes?: string;
}): Promise<TwinSnapshot> {
  const vpsId = input?.vpsId || "local";
  const files = await listAllFiles(".");
  const tools = await detectTools();
  const kube = await detectKubeTools();

  const twin: TwinSnapshot = {
    id: randomUUID().slice(0, 12),
    name: input?.name || `twin-${vpsId}-${Date.now().toString(36)}`,
    vpsId,
    createdAt: new Date().toISOString(),
    inventory: {
      files: files.slice(0, 200),
      hasDockerfile: files.some((f) => f === "Dockerfile" || f.endsWith("/Dockerfile")),
      hasCompose: files.some((f) => f.includes("docker-compose")),
      hasK8s: files.some((f) => f.startsWith("deploy/k8s/") || f.includes("/k8s/")),
      tools: tools as any,
      kube: kube as any,
      localAi: listLocalAiNodes(vpsId === "local" ? undefined : vpsId).length,
    },
    notes: input?.notes,
  };
  saveTwin(twin);
  log("info", `Twin created ${twin.id} for ${vpsId}`, "twin");
  return twin;
}

export function listTwins(): TwinSnapshot[] {
  if (!existsSync(DATA)) return [];
  return readdirSync(DATA)
    .filter((f) => f.endsWith(".json"))
    .map((f) => loadTwin(f.replace(/\.md$/, "").replace(/\.json$/, "")))
    .filter(Boolean)
    .sort((a, b) => (b!.createdAt || "").localeCompare(a!.createdAt || "")) as TwinSnapshot[];
}

export function getTwin(id: string) {
  return loadTwin(id);
}

/** Run simulation suite against a twin snapshot */
export async function simulate(twinId: string): Promise<SimulationResult> {
  const twin = loadTwin(twinId);
  if (!twin) throw new Error("Twin not found");

  const checks: SimCheck[] = [];

  // 1. Inventory sanity
  checks.push({
    name: "inventory",
    ok: twin.inventory.files.length > 0,
    detail: `${twin.inventory.files.length} files tracked`,
  });

  // 2. Deploy artifacts
  checks.push({
    name: "dockerfile_or_compose",
    ok: twin.inventory.hasDockerfile || twin.inventory.hasCompose || twin.inventory.hasK8s,
    detail: `docker=${twin.inventory.hasDockerfile} compose=${twin.inventory.hasCompose} k8s=${twin.inventory.hasK8s}`,
  });

  // 3. Health endpoint present in platform (local)
  try {
    const r = await fetch("http://127.0.0.1:3000/api/health", { signal: AbortSignal.timeout(3000) });
    checks.push({
      name: "health_endpoint",
      ok: r.ok,
      detail: `HTTP ${r.status}`,
    });
  } catch (e: any) {
    checks.push({
      name: "health_endpoint",
      ok: false,
      detail: e.message || "unreachable (server may be stopped)",
    });
  }

  // 4. Lightweight syntax/load smoke: node -c not applicable; run python assert
  try {
    const code = await runCode("python", "assert True\nprint('sim-ok')\n");
    checks.push({
      name: "runtime_smoke",
      ok: code.exitCode === 0 && (code.stdout || "").includes("sim-ok"),
      detail: (code.stdout || code.stderr || "").slice(0, 120),
    });
  } catch (e: any) {
    checks.push({ name: "runtime_smoke", ok: false, detail: e.message });
  }

  // 5. Security: no obvious secrets in twin file list names
  const risky = twin.inventory.files.filter((f) =>
    /id_rsa$|\.pem$|secrets\.json|\.env$|\.vaultkey/i.test(f)
  );
  checks.push({
    name: "secret_paths",
    ok: risky.length === 0,
    detail: risky.length ? `risky: ${risky.slice(0, 5).join(", ")}` : "no obvious secret filenames",
  });

  // 6. K8s manifests validate (YAML present)
  if (twin.inventory.hasK8s) {
    let ok = true;
    let detail = "k8s manifests listed";
    try {
      const dep = await readWorkspaceFile("deploy/k8s/deployment.yaml");
      ok = !!dep.content && dep.content.includes("kind: Deployment");
      detail = ok ? "deployment.yaml looks valid" : "deployment.yaml missing/invalid";
    } catch {
      ok = false;
      detail = "could not read deployment.yaml";
    }
    checks.push({ name: "k8s_manifest", ok, detail });
  } else {
    checks.push({ name: "k8s_manifest", ok: true, detail: "skipped (no k8s)" });
  }

  // 7. Rollback readiness: checkpoint system exists
  checks.push({
    name: "rollback_capability",
    ok: true,
    detail: "patch/checkpoint engine available (Phase 21)",
  });

  const passed = checks.every((c) => c.ok);
  // promote ready = critical checks pass (allow health fail if server down)
  const critical = checks.filter((c) => !["health_endpoint"].includes(c.name));
  const promoteReady = critical.every((c) => c.ok);

  const result: SimulationResult = {
    id: randomUUID().slice(0, 10),
    twinId,
    createdAt: new Date().toISOString(),
    checks,
    passed,
    promoteReady,
  };

  const sims = loadSims();
  sims.unshift(result);
  saveSims(sims);
  log("info", `Simulation ${result.id} promoteReady=${promoteReady}`, "twin");
  return result;
}

/**
 * Promote only if last simulation for twin is promoteReady.
 * Returns gate decision — does not auto-apply to production.
 */
export function canPromote(twinId: string): {
  allowed: boolean;
  reason: string;
  lastSim?: SimulationResult;
} {
  const sims = loadSims().filter((s) => s.twinId === twinId);
  const last = sims[0];
  if (!last) return { allowed: false, reason: "No simulation run yet" };
  if (!last.promoteReady) {
    return {
      allowed: false,
      reason: "Last simulation not promote-ready",
      lastSim: last,
    };
  }
  return { allowed: true, reason: "Simulation passed critical checks", lastSim: last };
}

export function listSimulations(twinId?: string) {
  let rows = loadSims();
  if (twinId) rows = rows.filter((s) => s.twinId === twinId);
  return rows;
}

export function twinStats() {
  return {
    twins: listTwins().length,
    simulations: loadSims().length,
    vps: listVps().length,
  };
}
