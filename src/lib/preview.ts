/**
 * Phase 12 — Live Preview manager
 * Static workspace preview + optional port registry for running apps
 */

import { WORKSPACE } from "./codeRunner.js";
import { log } from "./logger.js";
import { existsSync, readFileSync, statSync } from "fs";
import { join, resolve, relative, extname } from "path";

export type PreviewState = {
  entry: string; // relative path e.g. index.html
  updatedAt: string;
};

export type PortMapping = {
  port: number;
  label: string;
  url: string;
  createdAt: string;
};

let state: PreviewState = {
  entry: "index.html",
  updatedAt: new Date().toISOString(),
};

const ports = new Map<number, PortMapping>();

export function getPreviewState(): PreviewState {
  return { ...state };
}

export function setPreviewEntry(entry: string): PreviewState {
  const cleaned = entry.replace(/^\/+/, "");
  state = { entry: cleaned || "index.html", updatedAt: new Date().toISOString() };
  log("info", `Preview entry → ${state.entry}`, "preview");
  return getPreviewState();
}

export function registerPort(port: number, label = "app"): PortMapping {
  const mapping: PortMapping = {
    port,
    label,
    url: `http://127.0.0.1:${port}`,
    createdAt: new Date().toISOString(),
  };
  ports.set(port, mapping);
  log("info", `Port registered ${port} (${label})`, "preview");
  return mapping;
}

export function unregisterPort(port: number): boolean {
  const ok = ports.delete(port);
  if (ok) log("info", `Port unregistered ${port}`, "preview");
  return ok;
}

export function listPorts(): PortMapping[] {
  return [...ports.values()];
}

/** Resolve a safe file path inside workspace for preview */
export function resolvePreviewPath(urlPath: string): string | null {
  const rel = decodeURIComponent(urlPath || state.entry).replace(/^\/+/, "");
  const abs = resolve(WORKSPACE, rel);
  if (!abs.startsWith(WORKSPACE)) return null;
  if (!existsSync(abs) || !statSync(abs).isFile()) return null;
  return abs;
}

export function contentTypeFor(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
  };
  return map[ext] || "application/octet-stream";
}

export function readPreviewFile(abs: string): Buffer {
  return readFileSync(abs);
}

export function workspacePublicUrl(entry?: string): string {
  const e = (entry || state.entry).replace(/^\/+/, "");
  return `/preview/${e}`;
}
