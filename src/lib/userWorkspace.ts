/**
 * Phase S6 — Per-user workspace isolation
 */

import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, resolve, sep } from "path";
import { ApiError } from "./apiResponse.js";

const ROOT = join(process.cwd(), "workspace");
mkdirSync(ROOT, { recursive: true });

export function userWorkspaceRoot(userId: string) {
  if (!userId || !/^[a-zA-Z0-9_-]+$/.test(userId)) {
    throw new ApiError(400, "invalid_user", "Invalid user id");
  }
  const dir = join(ROOT, "users", userId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolve path inside user workspace (prevents escape) */
export function safeUserPath(userId: string, rel = ".") {
  const root = userWorkspaceRoot(userId);
  const target = resolve(root, rel || ".");
  if (!target.startsWith(root + sep) && target !== root) {
    throw new ApiError(400, "invalid_path", "Path escapes workspace");
  }
  return target;
}

export function listUserFiles(userId: string, rel = "."): string[] {
  const base = safeUserPath(userId, rel);
  if (!existsSync(base)) return [];
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const relPath = prefix ? `${prefix}/${name}` : name;
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs, relPath);
      else out.push(relPath);
    }
  };
  const st = statSync(base);
  if (st.isFile()) return [rel === "." ? base : rel];
  walk(base, rel === "." ? "" : rel);
  return out.filter(Boolean);
}

/** Approximate storage usage in bytes */
export function userStorageBytes(userId: string): number {
  const root = userWorkspaceRoot(userId);
  let total = 0;
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else total += st.size;
    }
  };
  walk(root);
  return total;
}

export function userStorageMb(userId: string) {
  return Math.round((userStorageBytes(userId) / (1024 * 1024)) * 100) / 100;
}
