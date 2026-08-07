/**
 * Phase 24 — Admin + Security
 * Secrets vault, audit log, permissions, approvals, admin token
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { log } from "./logger.js";

const DATA = join(process.cwd(), ".data");
mkdirSync(DATA, { recursive: true });

const SECRETS_FILE = join(DATA, "secrets.json");
const AUDIT_FILE = join(DATA, "audit.json");
const PERMS_FILE = join(DATA, "permissions.json");
const APPROVALS_FILE = join(DATA, "approvals.json");
const ADMIN_FILE = join(DATA, "admin.json");

// ── Admin token ───────────────────────────────────────────────

type AdminState = { tokenHash: string | null; createdAt?: string };

function loadAdmin(): AdminState {
  if (!existsSync(ADMIN_FILE)) return { tokenHash: null };
  try {
    return JSON.parse(readFileSync(ADMIN_FILE, "utf8"));
  } catch {
    return { tokenHash: null };
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hasAdminToken(): boolean {
  return !!loadAdmin().tokenHash;
}

/** Set or rotate admin token; returns the plaintext token once */
export function setAdminToken(token?: string): { token: string } {
  const t = token || randomBytes(24).toString("hex");
  writeFileSync(
    ADMIN_FILE,
    JSON.stringify({ tokenHash: hashToken(t), createdAt: new Date().toISOString() }, null, 2)
  );
  audit("admin", "admin_token_set", {});
  return { token: t };
}

export function verifyAdminToken(token: string | undefined | null): boolean {
  const admin = loadAdmin();
  if (!admin.tokenHash) return true; // open until configured
  if (!token) return false;
  return hashToken(token) === admin.tokenHash;
}

// ── Secrets vault (AES-256-GCM with key derived from admin token or local key) ─

const LOCAL_KEY_FILE = join(DATA, ".vaultkey");

function vaultKey(): Buffer {
  if (!existsSync(LOCAL_KEY_FILE)) {
    writeFileSync(LOCAL_KEY_FILE, randomBytes(32));
  }
  return readFileSync(LOCAL_KEY_FILE);
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", vaultKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decrypt(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", vaultKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

type SecretsStore = Record<string, string>; // key -> encrypted

function loadSecrets(): SecretsStore {
  if (!existsSync(SECRETS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(SECRETS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveSecrets(s: SecretsStore) {
  writeFileSync(SECRETS_FILE, JSON.stringify(s, null, 2));
}

export function setSecret(key: string, value: string) {
  const s = loadSecrets();
  s[key] = encrypt(value);
  saveSecrets(s);
  audit("secrets", "set", { key });
  log("info", `Secret set: ${key}`, "security");
}

export function getSecret(key: string): string | null {
  const s = loadSecrets();
  if (!s[key]) return null;
  try {
    return decrypt(s[key]);
  } catch {
    return null;
  }
}

export function listSecretKeys(): string[] {
  return Object.keys(loadSecrets());
}

export function deleteSecret(key: string) {
  const s = loadSecrets();
  delete s[key];
  saveSecrets(s);
  audit("secrets", "delete", { key });
}

// ── Permissions ───────────────────────────────────────────────

export type Permissions = {
  allowShell: boolean;
  allowInstall: boolean;
  allowFileWrite: boolean;
  allowFileDelete: boolean;
  allowNetwork: boolean;
  requireApprovalFor: string[]; // tool names
  maxAgentIterations: number;
};

const DEFAULT_PERMS: Permissions = {
  allowShell: true,
  allowInstall: true,
  allowFileWrite: true,
  allowFileDelete: true,
  allowNetwork: true,
  requireApprovalFor: [],
  maxAgentIterations: 12,
};

export function getPermissions(): Permissions {
  if (!existsSync(PERMS_FILE)) return { ...DEFAULT_PERMS };
  try {
    return { ...DEFAULT_PERMS, ...JSON.parse(readFileSync(PERMS_FILE, "utf8")) };
  } catch {
    return { ...DEFAULT_PERMS };
  }
}

export function setPermissions(patch: Partial<Permissions>): Permissions {
  const next = { ...getPermissions(), ...patch };
  writeFileSync(PERMS_FILE, JSON.stringify(next, null, 2));
  audit("permissions", "update", patch as any);
  return next;
}

export function isToolAllowed(toolName: string): { ok: boolean; reason?: string; needsApproval?: boolean } {
  const p = getPermissions();
  if (toolName === "shell_command" && !p.allowShell) return { ok: false, reason: "Shell disabled by admin" };
  if (toolName === "install_package" && !p.allowInstall) return { ok: false, reason: "Install disabled by admin" };
  if ((toolName === "write_file" || toolName === "mkdir") && !p.allowFileWrite)
    return { ok: false, reason: "File write disabled by admin" };
  if (toolName === "delete_file" && !p.allowFileDelete) return { ok: false, reason: "File delete disabled by admin" };
  if (toolName === "web_search" && !p.allowNetwork) return { ok: false, reason: "Network disabled by admin" };
  if (p.requireApprovalFor.includes(toolName)) return { ok: true, needsApproval: true };
  return { ok: true };
}

// ── Approvals ─────────────────────────────────────────────────

export type Approval = {
  id: string;
  toolName: string;
  args: any;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  decidedAt?: string;
};

function loadApprovals(): Approval[] {
  if (!existsSync(APPROVALS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(APPROVALS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveApprovals(list: Approval[]) {
  writeFileSync(APPROVALS_FILE, JSON.stringify(list.slice(0, 200), null, 2));
}

export function requestApproval(toolName: string, args: any): Approval {
  const a: Approval = {
    id: randomBytes(6).toString("hex"),
    toolName,
    args,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  const list = loadApprovals();
  list.unshift(a);
  saveApprovals(list);
  audit("approval", "requested", { id: a.id, toolName });
  return a;
}

export function listApprovals(status?: string): Approval[] {
  const list = loadApprovals();
  return status ? list.filter((a) => a.status === status) : list;
}

export function decideApproval(id: string, approve: boolean): Approval | null {
  const list = loadApprovals();
  const a = list.find((x) => x.id === id);
  if (!a || a.status !== "pending") return null;
  a.status = approve ? "approved" : "denied";
  a.decidedAt = new Date().toISOString();
  saveApprovals(list);
  audit("approval", a.status, { id });
  return a;
}

// ── Audit log ─────────────────────────────────────────────────

export type AuditEntry = {
  id: string;
  ts: string;
  actor: string;
  action: string;
  detail?: any;
};

function loadAudit(): AuditEntry[] {
  if (!existsSync(AUDIT_FILE)) return [];
  try {
    return JSON.parse(readFileSync(AUDIT_FILE, "utf8"));
  } catch {
    return [];
  }
}

export function audit(actor: string, action: string, detail?: any) {
  const list = loadAudit();
  list.unshift({
    id: randomBytes(4).toString("hex"),
    ts: new Date().toISOString(),
    actor,
    action,
    detail,
  });
  writeFileSync(AUDIT_FILE, JSON.stringify(list.slice(0, 500), null, 2));
}

export function listAudit(limit = 100): AuditEntry[] {
  return loadAudit().slice(0, limit);
}

export function adminOverview() {
  return {
    adminTokenConfigured: hasAdminToken(),
    secrets: listSecretKeys().length,
    permissions: getPermissions(),
    pendingApprovals: listApprovals("pending").length,
    auditEntries: loadAudit().length,
  };
}
