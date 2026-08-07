/**
 * Phase 25 — Credential Broker
 * Store service credentials in encrypted vault. AI never receives raw secrets.
 * Server-side tools call resolveCredential() / withCredential().
 */

import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { setSecret, getSecret, deleteSecret, listSecretKeys, audit } from "./security.js";
import { log } from "./logger.js";

const DATA = join(process.cwd(), ".data");
const REGISTRY = join(DATA, "credentials.json");
mkdirSync(DATA, { recursive: true });

export type ServiceKind =
  | "github"
  | "gitlab"
  | "gmail"
  | "ssh"
  | "openai"
  | "anthropic"
  | "groq"
  | "openrouter"
  | "slack"
  | "jira"
  | "custom";

export type CredentialMeta = {
  id: string;
  service: ServiceKind;
  label: string;
  /** username / email / host — NOT secret */
  principal?: string;
  scopes: string[];
  projectIds: string[];
  /** vault key where secret lives */
  vaultKey: string;
  masked: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  status: "active" | "revoked";
};

type Registry = { items: CredentialMeta[] };

function loadReg(): Registry {
  if (!existsSync(REGISTRY)) return { items: [] };
  try {
    return JSON.parse(readFileSync(REGISTRY, "utf8"));
  } catch {
    return { items: [] };
  }
}

function saveReg(r: Registry) {
  writeFileSync(REGISTRY, JSON.stringify(r, null, 2));
}

function maskSecret(secret: string): string {
  if (!secret) return "****";
  if (secret.length <= 8) return "****" + secret.slice(-2);
  return secret.slice(0, 3) + "****" + secret.slice(-4);
}

function vaultKeyFor(id: string) {
  return `cred:${id}`;
}

export function listCredentials(filter?: {
  service?: ServiceKind;
  projectId?: string;
  includeRevoked?: boolean;
}): CredentialMeta[] {
  let items = loadReg().items;
  if (!filter?.includeRevoked) items = items.filter((i) => i.status === "active");
  if (filter?.service) items = items.filter((i) => i.service === filter.service);
  if (filter?.projectId) {
    items = items.filter(
      (i) => !i.projectIds.length || i.projectIds.includes(filter.projectId!)
    );
  }
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getCredentialMeta(id: string): CredentialMeta | null {
  return loadReg().items.find((i) => i.id === id) || null;
}

/** NEVER expose this to LLM prompts */
export function resolveSecret(id: string): string | null {
  const meta = getCredentialMeta(id);
  if (!meta || meta.status !== "active") return null;
  const secret = getSecret(meta.vaultKey);
  if (secret) {
    const reg = loadReg();
    const item = reg.items.find((i) => i.id === id);
    if (item) {
      item.lastUsedAt = new Date().toISOString();
      saveReg(reg);
    }
    audit("broker", "resolve", { id, service: meta.service });
  }
  return secret;
}

export function addCredential(input: {
  service: ServiceKind;
  label: string;
  secret: string;
  principal?: string;
  scopes?: string[];
  projectIds?: string[];
}): CredentialMeta {
  if (!input.secret?.trim()) throw new Error("secret required");
  if (!input.service) throw new Error("service required");

  const id = randomUUID().slice(0, 12);
  const vaultKey = vaultKeyFor(id);
  setSecret(vaultKey, input.secret.trim());

  const meta: CredentialMeta = {
    id,
    service: input.service,
    label: input.label || input.service,
    principal: input.principal,
    scopes: input.scopes || [],
    projectIds: input.projectIds || [],
    vaultKey,
    masked: maskSecret(input.secret.trim()),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "active",
  };

  const reg = loadReg();
  reg.items.unshift(meta);
  saveReg(reg);
  audit("broker", "add", { id, service: meta.service, label: meta.label });
  log("info", `Credential added: ${meta.service}/${meta.label}`, "broker");
  return meta;
}

export function updateCredential(
  id: string,
  patch: {
    label?: string;
    principal?: string;
    scopes?: string[];
    projectIds?: string[];
    secret?: string;
  }
): CredentialMeta {
  const reg = loadReg();
  const item = reg.items.find((i) => i.id === id);
  if (!item || item.status === "revoked") throw new Error("Credential not found");

  if (patch.label !== undefined) item.label = patch.label;
  if (patch.principal !== undefined) item.principal = patch.principal;
  if (patch.scopes) item.scopes = patch.scopes;
  if (patch.projectIds) item.projectIds = patch.projectIds;
  if (patch.secret?.trim()) {
    setSecret(item.vaultKey, patch.secret.trim());
    item.masked = maskSecret(patch.secret.trim());
  }
  item.updatedAt = new Date().toISOString();
  saveReg(reg);
  audit("broker", "update", { id });
  return item;
}

export function revokeCredential(id: string): CredentialMeta {
  const reg = loadReg();
  const item = reg.items.find((i) => i.id === id);
  if (!item) throw new Error("Credential not found");
  item.status = "revoked";
  item.updatedAt = new Date().toISOString();
  try {
    deleteSecret(item.vaultKey);
  } catch {
    /* ignore */
  }
  saveReg(reg);
  audit("broker", "revoke", { id, service: item.service });
  log("info", `Credential revoked: ${id}`, "broker");
  return item;
}

/** Pick best active credential for a service (+ optional project) */
export function findCredential(
  service: ServiceKind,
  projectId?: string
): CredentialMeta | null {
  const list = listCredentials({ service, projectId });
  return list[0] || null;
}

/**
 * Server-side only: run fn with raw secret, never return secret to caller chain toward LLM.
 */
export async function withCredential<T>(
  service: ServiceKind,
  fn: (ctx: { secret: string; meta: CredentialMeta }) => Promise<T> | T,
  projectId?: string
): Promise<T> {
  const meta = findCredential(service, projectId);
  if (!meta) throw new Error(`No active credential for ${service}`);
  const secret = resolveSecret(meta.id);
  if (!secret) throw new Error(`Secret missing for ${service}`);
  return fn({ secret, meta });
}

/** Safe descriptor for AI tools — no secrets */
export function credentialsForAgent(): {
  id: string;
  service: string;
  label: string;
  principal?: string;
  scopes: string[];
  masked: string;
}[] {
  return listCredentials().map((c) => ({
    id: c.id,
    service: c.service,
    label: c.label,
    principal: c.principal,
    scopes: c.scopes,
    masked: c.masked,
  }));
}

/** GitHub API helper using broker — returns API JSON, not token */
export async function githubApi(
  path: string,
  opts: { method?: string; body?: any; credentialId?: string } = {}
): Promise<{ status: number; data: any }> {
  let secret: string | null = null;
  let meta: CredentialMeta | null = null;

  if (opts.credentialId) {
    meta = getCredentialMeta(opts.credentialId);
    secret = resolveSecret(opts.credentialId);
  } else {
    meta = findCredential("github");
    secret = meta ? resolveSecret(meta.id) : null;
  }
  if (!secret) throw new Error("No GitHub credential configured");

  const url = path.startsWith("http") ? path : `https://api.github.com${path.startsWith("/") ? path : "/" + path}`;
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "AI-Agent-Pro-Broker",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep text */
  }
  audit("broker", "github_api", { path, status: res.status, cred: meta?.id });
  return { status: res.status, data };
}

export function brokerStats() {
  const all = loadReg().items;
  const byService: Record<string, number> = {};
  for (const i of all) {
    if (i.status !== "active") continue;
    byService[i.service] = (byService[i.service] || 0) + 1;
  }
  return {
    total: all.length,
    active: all.filter((i) => i.status === "active").length,
    revoked: all.filter((i) => i.status === "revoked").length,
    byService,
  };
}
