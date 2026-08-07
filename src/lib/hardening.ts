/**
 * Phase 47 — Hardening
 * Rate limits, secret redaction, policy packs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Request, Response, NextFunction } from "express";
import { log } from "./logger.js";

const DATA = join(process.cwd(), ".data");
const POLICY_FILE = join(DATA, "policy.json");
mkdirSync(DATA, { recursive: true });

export type PolicyPack = {
  name: string;
  rateLimitPerMin: number;
  maxBodyBytes: number;
  blockDangerousShell: boolean;
  redactLogs: boolean;
  requireAdminForDeploy: boolean;
  requireAdminForVpsExec: boolean;
  allowNetworkTools: boolean;
};

const DEFAULT_POLICY: PolicyPack = {
  name: "default",
  rateLimitPerMin: 120,
  maxBodyBytes: 2_000_000,
  blockDangerousShell: true,
  redactLogs: true,
  requireAdminForDeploy: false,
  requireAdminForVpsExec: false,
  allowNetworkTools: true,
};

export function getPolicy(): PolicyPack {
  try {
    if (!existsSync(POLICY_FILE)) return { ...DEFAULT_POLICY };
    return { ...DEFAULT_POLICY, ...JSON.parse(readFileSync(POLICY_FILE, "utf8")) };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

export function setPolicy(patch: Partial<PolicyPack>): PolicyPack {
  const next = { ...getPolicy(), ...patch };
  writeFileSync(POLICY_FILE, JSON.stringify(next, null, 2));
  log("info", `Policy updated: ${next.name}`, "hardening");
  return next;
}

/** Redact secrets/tokens from text */
export function redactSecrets(input: string): string {
  if (!input) return input;
  let s = input;
  const patterns: RegExp[] = [
    /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
    /\bsk-[A-Za-z0-9]{20,}\b/g,
    /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g,
    /\bxai-[A-Za-z0-9]{20,}\b/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\b(api[_-]?key|apikey|secret|token|password|passwd|authorization)\s*[:=]\s*['"]?[^\s'"]{8,}/gi,
    /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/g,
    /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  ];
  for (const re of patterns) {
    s = s.replace(re, "[REDACTED]");
  }
  return s;
}

// ── Rate limiter (in-memory) ─────────────────────────────────

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  const policy = getPolicy();
  const key = req.ip || req.headers["x-forwarded-for"]?.toString() || "local";
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + 60_000 };
    buckets.set(key, b);
  }
  b.count += 1;
  res.setHeader("X-RateLimit-Limit", String(policy.rateLimitPerMin));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, policy.rateLimitPerMin - b.count)));
  if (b.count > policy.rateLimitPerMin) {
    return res.status(429).json({ error: "Rate limit exceeded", retryAfterSec: Math.ceil((b.resetAt - now) / 1000) });
  }
  next();
}

const DANGEROUS = [
  /\brm\b/,
  /\brmdir\b/,
  /\bunlink\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /:\(\)\s*\{\s*:\|:\s*&\s*\};:/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bdrop\s+database\b/i,
  /\bchmod\s+-R\s+777\b/,
  /\b(curl|wget)\b.*\|\s*(ba)?sh\b/i,
];

export function isDangerousCommand(cmd: string): boolean {
  if (!getPolicy().blockDangerousShell) return false;
  return DANGEROUS.some((re) => re.test(cmd));
}

export function hardeningStatus() {
  return {
    policy: getPolicy(),
    rateBuckets: buckets.size,
  };
}

/** Policy presets */
export function applyPreset(name: "default" | "strict" | "dev"): PolicyPack {
  if (name === "strict") {
    return setPolicy({
      name: "strict",
      rateLimitPerMin: 60,
      blockDangerousShell: true,
      redactLogs: true,
      requireAdminForDeploy: true,
      requireAdminForVpsExec: true,
      allowNetworkTools: true,
    });
  }
  if (name === "dev") {
    return setPolicy({
      name: "dev",
      rateLimitPerMin: 600,
      blockDangerousShell: true,
      redactLogs: true,
      requireAdminForDeploy: false,
      requireAdminForVpsExec: false,
      allowNetworkTools: true,
    });
  }
  return setPolicy({ ...DEFAULT_POLICY, name: "default" });
}
