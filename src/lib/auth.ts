/**
 * Phase S2 — Users, password hashing (scrypt), JWT (HMAC-SHA256)
 * Storage: Firebase Firestore (primary) with file fallback
 */

import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHmac,
} from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Request, Response, NextFunction } from "express";
import { ApiError } from "./apiResponse.js";
import {
  getFirestore,
  initFirebase,
  fsGet,
  fsSet,
  fsQuery,
  fsList,
  cols,
} from "./firebase.js";

const DATA = join(process.cwd(), ".data");
const USERS_FILE = join(DATA, "users.json");
mkdirSync(DATA, { recursive: true });

const JWT_SECRET =
  process.env.JWT_SECRET ||
  process.env.ADMIN_TOKEN ||
  "dev-change-me-ai-agent-pro-s2";
const JWT_TTL_SEC = Number(process.env.JWT_TTL_SEC || 60 * 60 * 24 * 7); // 7d

export type UserRole = "user" | "admin";

export type UserRecord = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  passwordSalt: string;
  role: UserRole;
  emailVerified: boolean;
  plan: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  banned?: boolean;
};

type UserStore = { users: UserRecord[] };

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function newId() {
  return randomBytes(8).toString("hex");
}

export function hashPassword(password: string, salt?: string) {
  const s = salt || randomBytes(16).toString("hex");
  const hash = scryptSync(password, s, 32).toString("hex");
  return { hash, salt: s };
}

export function verifyPassword(password: string, hash: string, salt: string) {
  const next = scryptSync(password, salt, 32);
  const prev = Buffer.from(hash, "hex");
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}

function b64url(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function signToken(payload: Record<string, unknown>, ttlSec = JWT_TTL_SEC) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSec };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(body));
  const sig = createHmac("sha256", JWT_SECRET)
    .update(`${h}.${p}`)
    .digest();
  return `${h}.${p}.${b64url(sig)}`;
}

export function verifyToken(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const expect = b64url(
      createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest()
    );
    const a = Buffer.from(s);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const json = Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8"
    );
    const payload = JSON.parse(json) as Record<string, unknown>;
    const exp = Number(payload.exp || 0);
    if (exp && exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function publicUser(u: UserRecord) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    emailVerified: u.emailVerified,
    plan: u.plan || "free",
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt || null,
  };
}

function useFirebase(): boolean {
  initFirebase();
  return !!getFirestore();
}

// ---------- File fallback ----------
function loadFile(): UserStore {
  if (!existsSync(USERS_FILE)) return { users: [] };
  try {
    return JSON.parse(readFileSync(USERS_FILE, "utf8")) as UserStore;
  } catch {
    return { users: [] };
  }
}

function saveFile(store: UserStore) {
  writeFileSync(USERS_FILE, JSON.stringify(store, null, 2));
}

// ---------- Firestore-backed ops ----------

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const e = normalizeEmail(email);
  if (useFirebase()) {
    const rows = await fsQuery(cols.users, [{ field: "email", op: "==", value: e }], undefined, 1);
    return (rows[0] as UserRecord) || null;
  }
  return loadFile().users.find((u) => u.email === e) || null;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  if (useFirebase()) {
    const row = await fsGet(cols.users, id);
    return (row as UserRecord) || null;
  }
  return loadFile().users.find((u) => u.id === id) || null;
}

export async function registerUser(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<UserRecord> {
  const email = normalizeEmail(input.email);
  if (!email || !email.includes("@")) {
    throw new ApiError(400, "invalid_email", "Valid email required");
  }
  if (!input.password || input.password.length < 8) {
    throw new ApiError(400, "weak_password", "Password must be at least 8 characters");
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    throw new ApiError(409, "email_exists", "Email already registered");
  }

  const { hash, salt } = hashPassword(input.password);
  const now = new Date().toISOString();
  const id = newId();

  let role: UserRole = "user";
  if (useFirebase()) {
    const all = await fsList(cols.users, 5);
    if (all.length === 0) role = "admin";
  } else {
    if (loadFile().users.length === 0) role = "admin";
  }

  const user: UserRecord = {
    id,
    email,
    name: (input.name || email.split("@")[0]).slice(0, 80),
    passwordHash: hash,
    passwordSalt: salt,
    role,
    emailVerified: false,
    plan: "free",
    createdAt: now,
    updatedAt: now,
  };

  if (useFirebase()) {
    await fsSet(cols.users, id, user, false);
  } else {
    const store = loadFile();
    store.users.push(user);
    saveFile(store);
  }
  return user;
}

export async function loginUser(email: string, password: string): Promise<UserRecord> {
  const user = await findUserByEmail(email);
  if (!user) {
    throw new ApiError(401, "invalid_credentials", "Invalid email or password");
  }
  if (user.banned) {
    throw new ApiError(403, "banned", "Account is banned");
  }
  if (!verifyPassword(password, user.passwordHash, user.passwordSalt)) {
    throw new ApiError(401, "invalid_credentials", "Invalid email or password");
  }
  const now = new Date().toISOString();
  user.lastLoginAt = now;
  user.updatedAt = now;

  if (useFirebase()) {
    await fsSet(cols.users, user.id, { lastLoginAt: now, updatedAt: now }, true);
  } else {
    const store = loadFile();
    const idx = store.users.findIndex((u) => u.id === user.id);
    if (idx >= 0) {
      store.users[idx].lastLoginAt = now;
      store.users[idx].updatedAt = now;
      saveFile(store);
      return store.users[idx];
    }
  }
  return user;
}

export type AuthRequest = Request & { user?: ReturnType<typeof publicUser>; userId?: string };

export function requireAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ")
    ? header.slice(7).trim()
    : String(req.headers["x-access-token"] || "");
  if (!token) {
    return next(new ApiError(401, "unauthorized", "Missing bearer token"));
  }
  const payload = verifyToken(token);
  if (!payload || !payload.sub) {
    return next(new ApiError(401, "unauthorized", "Invalid or expired token"));
  }

  findUserById(String(payload.sub))
    .then((user) => {
      if (!user || user.banned) {
        return next(new ApiError(401, "unauthorized", "User not found or banned"));
      }
      req.user = publicUser(user);
      req.userId = user.id;
      next();
    })
    .catch((e) => next(e));
}

export function requireAdmin(req: AuthRequest, _res: Response, next: NextFunction) {
  requireAuth(req, _res, (err?: any) => {
    if (err) return next(err);
    if (req.user?.role !== "admin") {
      return next(new ApiError(403, "forbidden", "Admin only"));
    }
    next();
  });
}

export async function markEmailVerified(email: string): Promise<UserRecord> {
  const e = normalizeEmail(email);
  const user = await findUserByEmail(e);
  if (!user) throw new ApiError(404, "not_found", "User not found");
  user.emailVerified = true;
  user.updatedAt = new Date().toISOString();
  if (useFirebase()) {
    await fsSet(cols.users, user.id, { emailVerified: true, updatedAt: user.updatedAt }, true);
  } else {
    const store = loadFile();
    const idx = store.users.findIndex((u) => u.email === e);
    if (idx >= 0) {
      store.users[idx].emailVerified = true;
      store.users[idx].updatedAt = user.updatedAt;
      saveFile(store);
      return store.users[idx];
    }
  }
  return user;
}

export async function updatePassword(email: string, newPassword: string): Promise<UserRecord> {
  if (!newPassword || newPassword.length < 8) {
    throw new ApiError(400, "weak_password", "Password must be at least 8 characters");
  }
  const e = normalizeEmail(email);
  const user = await findUserByEmail(e);
  if (!user) throw new ApiError(404, "not_found", "User not found");
  const { hash, salt } = hashPassword(newPassword);
  user.passwordHash = hash;
  user.passwordSalt = salt;
  user.updatedAt = new Date().toISOString();
  if (useFirebase()) {
    await fsSet(
      cols.users,
      user.id,
      { passwordHash: hash, passwordSalt: salt, updatedAt: user.updatedAt },
      true
    );
  } else {
    const store = loadFile();
    const idx = store.users.findIndex((u) => u.email === e);
    if (idx >= 0) {
      store.users[idx].passwordHash = hash;
      store.users[idx].passwordSalt = salt;
      store.users[idx].updatedAt = user.updatedAt;
      saveFile(store);
      return store.users[idx];
    }
  }
  return user;
}

export async function setUserPlan(userId: string, plan: string): Promise<UserRecord> {
  const user = await findUserById(userId);
  if (!user) throw new ApiError(404, "not_found", "User not found");
  user.plan = plan;
  user.updatedAt = new Date().toISOString();
  if (useFirebase()) {
    await fsSet(cols.users, userId, { plan, updatedAt: user.updatedAt }, true);
  } else {
    const store = loadFile();
    const idx = store.users.findIndex((u) => u.id === userId);
    if (idx >= 0) {
      store.users[idx].plan = plan;
      store.users[idx].updatedAt = user.updatedAt;
      saveFile(store);
      return store.users[idx];
    }
  }
  return user;
}

export async function setUserBanned(userId: string, banned: boolean): Promise<UserRecord> {
  const user = await findUserById(userId);
  if (!user) throw new ApiError(404, "not_found", "User not found");
  user.banned = banned;
  user.updatedAt = new Date().toISOString();
  if (useFirebase()) {
    await fsSet(cols.users, userId, { banned, updatedAt: user.updatedAt }, true);
  } else {
    const store = loadFile();
    const idx = store.users.findIndex((u) => u.id === userId);
    if (idx >= 0) {
      store.users[idx].banned = banned;
      store.users[idx].updatedAt = user.updatedAt;
      saveFile(store);
      return store.users[idx];
    }
  }
  return user;
}

export async function listUsers(): Promise<ReturnType<typeof publicUser>[]> {
  if (useFirebase()) {
    const rows = await fsList(cols.users, 500);
    return (rows as UserRecord[]).map((u) => publicUser(u));
  }
  return loadFile().users.map((u) => publicUser(u));
}

export async function authStats() {
  if (useFirebase()) {
    const users = (await fsList(cols.users, 1000)) as UserRecord[];
    return {
      users: users.length,
      admins: users.filter((u) => u.role === "admin").length,
      verified: users.filter((u) => u.emailVerified).length,
      storage: "firestore",
    };
  }
  const users = loadFile().users;
  return {
    users: users.length,
    admins: users.filter((u) => u.role === "admin").length,
    verified: users.filter((u) => u.emailVerified).length,
    storage: "file",
  };
}
