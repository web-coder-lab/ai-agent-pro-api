/**
 * Phase 38 — Distributed Local AI per VPS
 * Register local model endpoints (Ollama-compatible) per VPS;
 * health probe; scoped inference; Head monitors, Owner gates deploy-ish ops.
 */

import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { log } from "./logger.js";
import { getVps, listVps, execOnVps } from "./vpsBroker.js";
import { routeModel } from "./modelRouter.js";

const DATA = join(process.cwd(), ".data");
const FILE_PRIMARY = join(DATA, "local-ai-cluster.json");
const FILE_FALLBACK = join("/tmp", "ai-agent-pro-local-ai.json");
mkdirSync(DATA, { recursive: true });

export type LocalAiNode = {
  id: string;
  vpsId: string; // "local" for this machine
  name: string;
  /** OpenAI-compatible base URL e.g. http://127.0.0.1:11434/v1 */
  baseURL: string;
  models: string[];
  status: "unknown" | "online" | "offline" | "error";
  lastCheckedAt?: string;
  lastError?: string;
  /** only this node may run jobs tagged with its vpsId */
  scope: "self";
  createdAt: string;
};

type Store = { nodes: LocalAiNode[] };

let _path: string | null = null;
function storePath(): string {
  if (_path) return _path;
  try {
    mkdirSync(DATA, { recursive: true });
    if (!existsSync(FILE_PRIMARY)) writeFileSync(FILE_PRIMARY, JSON.stringify({ nodes: [] }));
    _path = FILE_PRIMARY;
  } catch {
    _path = FILE_FALLBACK;
  }
  return _path;
}

function load(): Store {
  try {
    if (!existsSync(storePath())) return { nodes: [] };
    const s = JSON.parse(readFileSync(storePath(), "utf8"));
    return { nodes: Array.isArray(s.nodes) ? s.nodes : [] };
  } catch {
    return { nodes: [] };
  }
}

function save(s: Store) {
  try {
    writeFileSync(storePath(), JSON.stringify(s, null, 2));
  } catch {
    writeFileSync(FILE_FALLBACK, JSON.stringify(s, null, 2));
  }
}

export function listLocalAiNodes(vpsId?: string): LocalAiNode[] {
  let nodes = load().nodes;
  if (vpsId) nodes = nodes.filter((n) => n.vpsId === vpsId);
  return nodes.sort((a, b) => a.name.localeCompare(b.name));
}

export function getLocalAiNode(id: string): LocalAiNode | null {
  return load().nodes.find((n) => n.id === id) || null;
}

export function registerLocalAi(input: {
  vpsId?: string;
  name: string;
  baseURL: string;
  models?: string[];
}): LocalAiNode {
  if (!input.baseURL?.startsWith("http")) throw new Error("baseURL must be http(s)");
  const vpsId = input.vpsId || "local";
  if (vpsId !== "local" && !getVps(vpsId)) {
    throw new Error("VPS not found — register VPS first");
  }

  const node: LocalAiNode = {
    id: randomUUID().slice(0, 10),
    vpsId,
    name: input.name || `local-ai-${vpsId}`,
    baseURL: input.baseURL.replace(/\/$/, ""),
    models: input.models || [],
    status: "unknown",
    scope: "self",
    createdAt: new Date().toISOString(),
  };
  const s = load();
  s.nodes.unshift(node);
  save(s);
  log("info", `Local AI registered ${node.name} on ${vpsId}`, "local-ai");
  return node;
}

export function removeLocalAi(id: string): boolean {
  const s = load();
  const before = s.nodes.length;
  s.nodes = s.nodes.filter((n) => n.id !== id);
  save(s);
  return s.nodes.length < before;
}

/** Probe OpenAI-compatible /models or Ollama /api/tags via HTTP from this host */
export async function checkLocalAi(id: string): Promise<LocalAiNode> {
  const s = load();
  const node = s.nodes.find((n) => n.id === id);
  if (!node) throw new Error("Local AI node not found");

  try {
    const url = node.baseURL.includes("/v1")
      ? `${node.baseURL}/models`
      : `${node.baseURL}/api/tags`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const data: any = await res.json().catch(() => ({}));

    let models: string[] = [];
    if (Array.isArray(data?.data)) {
      models = data.data.map((m: any) => m.id).filter(Boolean);
    } else if (Array.isArray(data?.models)) {
      models = data.models.map((m: any) => m.name || m.model).filter(Boolean);
    }

    node.status = res.ok ? "online" : "error";
    if (models.length) node.models = models;
    node.lastCheckedAt = new Date().toISOString();
    node.lastError = res.ok ? undefined : `HTTP ${res.status}`;
  } catch (e: any) {
    node.status = "offline";
    node.lastError = e.message || String(e);
    node.lastCheckedAt = new Date().toISOString();
  }
  save(s);
  return node;
}

/**
 * Run a chat completion only on the node's own endpoint.
 * Enforces scope=self: cannot target another VPS's node from mismatched vpsId.
 */
export async function localChat(input: {
  nodeId: string;
  messages: { role: string; content: string }[];
  model?: string;
  /** caller must match node.vpsId unless admin override */
  callerVpsId?: string;
}): Promise<{ nodeId: string; model: string; content: string; usage?: any }> {
  const node = getLocalAiNode(input.nodeId);
  if (!node) throw new Error("Local AI node not found");

  if (input.callerVpsId && input.callerVpsId !== node.vpsId && input.callerVpsId !== "admin") {
    throw new Error(`Scope violation: node belongs to VPS ${node.vpsId}`);
  }

  const model = input.model || node.models[0] || "llama3.2";
  const base = node.baseURL.includes("/v1") ? node.baseURL : `${node.baseURL}/v1`;

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: input.messages,
      temperature: 0.2,
    }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Local AI HTTP ${res.status}`);
  }
  const content = data?.choices?.[0]?.message?.content || "";
  log("info", `Local AI chat ${node.name} model=${model}`, "local-ai");
  return { nodeId: node.id, model, content, usage: data.usage };
}

/** Head monitor: check all nodes */
export async function monitorCluster(): Promise<{
  nodes: LocalAiNode[];
  online: number;
  offline: number;
}> {
  const nodes = listLocalAiNodes();
  for (const n of nodes) {
    await checkLocalAi(n.id);
  }
  const refreshed = listLocalAiNodes();
  return {
    nodes: refreshed,
    online: refreshed.filter((n) => n.status === "online").length,
    offline: refreshed.filter((n) => n.status !== "online").length,
  };
}

/**
 * Owner-gated: start local model server on VPS via SSH (best-effort).
 * Does not auto-deploy without explicit call.
 */
export async function deployOllamaHint(vpsId: string): Promise<{
  vpsId: string;
  hint: string;
  remote?: { code: number; stdout: string; stderr: string };
}> {
  const hint =
    "curl -fsSL https://ollama.com/install.sh | sh && ollama serve && ollama pull llama3.2";
  if (vpsId === "local") {
    return { vpsId, hint };
  }
  // non-destructive check only by default
  try {
    const remote = await execOnVps(vpsId, "which ollama || echo OLLAMA_MISSING");
    return { vpsId, hint, remote };
  } catch (e: any) {
    return { vpsId, hint, remote: { code: 1, stdout: "", stderr: e.message } };
  }
}

/** Prefer local node for task=local when online */
export function pickLocalForTask(task: "local" | "fast" = "local"): LocalAiNode | null {
  const online = listLocalAiNodes().filter((n) => n.status === "online");
  if (online.length) return online[0];
  const any = listLocalAiNodes();
  return any[0] || null;
}

export function clusterStats() {
  const nodes = listLocalAiNodes();
  const vps = listVps();
  return {
    nodes: nodes.length,
    online: nodes.filter((n) => n.status === "online").length,
    vpsCount: vps.length,
    byVps: nodes.reduce((acc, n) => {
      acc[n.vpsId] = (acc[n.vpsId] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  };
}

/** Ensure a default local node pointing at common Ollama URL */
export function ensureDefaultLocalNode() {
  const existing = listLocalAiNodes("local");
  if (existing.length) return existing[0];
  return registerLocalAi({
    vpsId: "local",
    name: "local-ollama",
    baseURL: "http://127.0.0.1:11434/v1",
    models: ["llama3.2"],
  });
}
