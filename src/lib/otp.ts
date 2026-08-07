/**
 * Phase S3 — OTP + password-reset tokens
 */

import { randomInt, randomBytes, createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ApiError } from "./apiResponse.js";

const DATA = join(process.cwd(), ".data");
const FILE = join(DATA, "otp-tokens.json");
mkdirSync(DATA, { recursive: true });

type OtpRow = {
  id: string;
  email: string;
  purpose: "register" | "reset";
  codeHash?: string;
  tokenHash?: string;
  expiresAt: number;
  attempts: number;
};

type Store = { rows: OtpRow[] };

function load(): Store {
  if (!existsSync(FILE)) return { rows: [] };
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Store;
  } catch {
    return { rows: [] };
  }
}

function save(s: Store) {
  // drop expired
  const now = Date.now();
  s.rows = s.rows.filter((r) => r.expiresAt > now).slice(0, 500);
  writeFileSync(FILE, JSON.stringify(s, null, 2));
}

function hash(v: string) {
  return createHash("sha256").update(v).digest("hex");
}

export function createRegisterOtp(email: string, ttlMin = 10) {
  const code = String(randomInt(100000, 999999));
  const s = load();
  s.rows = s.rows.filter((r) => !(r.email === email && r.purpose === "register"));
  s.rows.push({
    id: randomBytes(8).toString("hex"),
    email: email.toLowerCase(),
    purpose: "register",
    codeHash: hash(code),
    expiresAt: Date.now() + ttlMin * 60 * 1000,
    attempts: 0,
  });
  save(s);
  return { code, expiresMinutes: ttlMin };
}

export function verifyRegisterOtp(email: string, code: string) {
  const s = load();
  const e = email.toLowerCase();
  const row = s.rows.find((r) => r.email === e && r.purpose === "register");
  if (!row) throw new ApiError(400, "otp_invalid", "No OTP pending for this email");
  if (row.expiresAt < Date.now()) {
    throw new ApiError(400, "otp_expired", "OTP expired");
  }
  row.attempts += 1;
  if (row.attempts > 8) {
    throw new ApiError(429, "otp_locked", "Too many attempts");
  }
  if (row.codeHash !== hash(String(code).trim())) {
    save(s);
    throw new ApiError(400, "otp_invalid", "Invalid code");
  }
  s.rows = s.rows.filter((r) => r.id !== row.id);
  save(s);
  return true;
}

export function createResetToken(email: string, ttlMin = 30) {
  const token = randomBytes(24).toString("hex");
  const s = load();
  s.rows = s.rows.filter((r) => !(r.email === email && r.purpose === "reset"));
  s.rows.push({
    id: randomBytes(8).toString("hex"),
    email: email.toLowerCase(),
    purpose: "reset",
    tokenHash: hash(token),
    expiresAt: Date.now() + ttlMin * 60 * 1000,
    attempts: 0,
  });
  save(s);
  return { token, expiresMinutes: ttlMin };
}

export function consumeResetToken(email: string, token: string) {
  const s = load();
  const e = email.toLowerCase();
  const row = s.rows.find((r) => r.email === e && r.purpose === "reset");
  if (!row || row.tokenHash !== hash(token)) {
    throw new ApiError(400, "reset_invalid", "Invalid or expired reset token");
  }
  if (row.expiresAt < Date.now()) {
    throw new ApiError(400, "reset_expired", "Reset token expired");
  }
  s.rows = s.rows.filter((r) => r.id !== row.id);
  save(s);
  return true;
}
