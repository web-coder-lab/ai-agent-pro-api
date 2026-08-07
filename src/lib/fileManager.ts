/**
 * Phase 3 — File System + Workspace Manager
 * Sandboxed to ./workspace • Path traversal safe • Tree + Zip
 */

import {
  readdir, readFile, writeFile, unlink, mkdir, rm, stat, rename,
} from "fs/promises";
import { existsSync, mkdirSync, createWriteStream, writeFileSync } from "fs";
import { join, resolve, relative, dirname, basename, extname } from "path";
import { spawn } from "child_process";
import { WORKSPACE } from "./codeRunner.js";

mkdirSync(WORKSPACE, { recursive: true });

export type FileNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modified?: string;
  children?: FileNode[];
};

/** Resolve path inside workspace; throws on traversal */
export function safePath(userPath: string = "."): string {
  const cleaned = (userPath || ".").replace(/^\/+/, "").replace(/\\/g, "/");
  const resolved = resolve(WORKSPACE, cleaned);
  if (!resolved.startsWith(WORKSPACE)) {
    throw new Error("Path traversal blocked");
  }
  return resolved;
}

/** Relative path from workspace root */
export function relPath(abs: string): string {
  return relative(WORKSPACE, abs) || ".";
}

export async function listTree(userPath: string = ".", depth = 6): Promise<FileNode[]> {
  const root = safePath(userPath);

  async function walk(dir: string, level: number): Promise<FileNode[]> {
    if (level > depth) return [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const nodes: FileNode[] = [];
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".git") continue;
      const abs = join(dir, e.name);
      const rel = relPath(abs);
      if (e.isDirectory()) {
        const children = await walk(abs, level + 1);
        nodes.push({ name: e.name, path: rel, type: "directory", children });
      } else {
        let size = 0;
        let modified: string | undefined;
        try {
          const s = await stat(abs);
          size = s.size;
          modified = s.mtime.toISOString();
        } catch {}
        nodes.push({ name: e.name, path: rel, type: "file", size, modified });
      }
    }
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return nodes;
  }

  return walk(root, 0);
}

export async function readWorkspaceFile(userPath: string): Promise<{ path: string; content: string; size: number }> {
  const abs = safePath(userPath);
  const content = await readFile(abs, "utf8");
  const s = await stat(abs);
  return { path: relPath(abs), content, size: s.size };
}

export async function writeWorkspaceFile(userPath: string, content: string): Promise<{ path: string; size: number }> {
  const abs = safePath(userPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content ?? "", "utf8");
  const s = await stat(abs);
  return { path: relPath(abs), size: s.size };
}

export async function deleteWorkspacePath(userPath: string): Promise<{ ok: boolean; path: string }> {
  const abs = safePath(userPath);
  if (abs === WORKSPACE) throw new Error("Cannot delete workspace root");
  const s = await stat(abs);
  if (s.isDirectory()) {
    await rm(abs, { recursive: true, force: true });
  } else {
    await unlink(abs);
  }
  return { ok: true, path: relPath(abs) };
}

export async function createDirectory(userPath: string): Promise<{ path: string }> {
  const abs = safePath(userPath);
  await mkdir(abs, { recursive: true });
  return { path: relPath(abs) };
}

export async function renamePath(from: string, to: string): Promise<{ from: string; to: string }> {
  const absFrom = safePath(from);
  const absTo = safePath(to);
  await mkdir(dirname(absTo), { recursive: true });
  await rename(absFrom, absTo);
  return { from: relPath(absFrom), to: relPath(absTo) };
}

function runCmd(cmd: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", (err) => resolve({ code: 1, stdout: "", stderr: err.message }));
  });
}

/** Export workspace (or subfolder) as zip → returns absolute path to zip */
export async function exportZip(userPath: string = "."): Promise<{ zipPath: string; size: number }> {
  const src = safePath(userPath);
  const outDir = join("/tmp", "ai-agent-exports");
  mkdirSync(outDir, { recursive: true });
  const name = `workspace-${Date.now()}.zip`;
  const zipPath = join(outDir, name);

  // Prefer zip command
  const hasZip = await runCmd(["which", "zip"], WORKSPACE);
  if (hasZip.code === 0) {
    const r = await runCmd(["zip", "-r", zipPath, "."], src);
    if (r.code !== 0) throw new Error(r.stderr || "zip failed");
  } else {
    // Fallback: tar.gz
    const tarPath = zipPath.replace(/\.zip$/, ".tar.gz");
    const r = await runCmd(["tar", "-czf", tarPath, "-C", src, "."], WORKSPACE);
    if (r.code !== 0) throw new Error(r.stderr || "tar failed");
    const s = await stat(tarPath);
    return { zipPath: tarPath, size: s.size };
  }
  const s = await stat(zipPath);
  return { zipPath, size: s.size };
}

/** Import zip into workspace (extract) */
export async function importZip(zipAbsPath: string, destUserPath: string = "."): Promise<{ extractedTo: string; files: number }> {
  const dest = safePath(destUserPath);
  await mkdir(dest, { recursive: true });

  if (!existsSync(zipAbsPath)) throw new Error("Zip file not found: " + zipAbsPath);

  const isTar = zipAbsPath.endsWith(".tar.gz") || zipAbsPath.endsWith(".tgz");
  let r;
  if (isTar) {
    r = await runCmd(["tar", "-xzf", zipAbsPath, "-C", dest], WORKSPACE);
  } else {
    const hasUnzip = await runCmd(["which", "unzip"], WORKSPACE);
    if (hasUnzip.code === 0) {
      r = await runCmd(["unzip", "-o", zipAbsPath, "-d", dest], WORKSPACE);
    } else {
      r = await runCmd(["tar", "-xf", zipAbsPath, "-C", dest], WORKSPACE);
    }
  }
  if (r && r.code !== 0) throw new Error(r.stderr || "extract failed");

  const tree = await listTree(destUserPath, 10);
  const countFiles = (nodes: FileNode[]): number =>
    nodes.reduce((n, x) => n + (x.type === "file" ? 1 : countFiles(x.children || [])), 0);

  return { extractedTo: relPath(dest), files: countFiles(tree) };
}

/** Flat list of all file paths */
export async function listAllFiles(userPath: string = "."): Promise<string[]> {
  const tree = await listTree(userPath, 20);
  const out: string[] = [];
  function walk(nodes: FileNode[]) {
    for (const n of nodes) {
      if (n.type === "file") out.push(n.path);
      else if (n.children) walk(n.children);
    }
  }
  walk(tree);
  return out;
}


/** Save base64 zip to /tmp and extract into workspace */
export async function importZipFromBase64(
  base64: string,
  destUserPath: string = "."
): Promise<{ extractedTo: string; files: number; tmp: string }> {
  const raw = base64.includes(",") ? base64.split(",")[1] : base64;
  const buf = Buffer.from(raw, "base64");
  if (buf.length > 50 * 1024 * 1024) throw new Error("Zip too large (max 50MB)");
  const outDir = join("/tmp", "ai-agent-imports");
  mkdirSync(outDir, { recursive: true });
  const tmp = join(outDir, `upload-${Date.now()}.zip`);
  writeFileSync(tmp, buf);
  const result = await importZip(tmp, destUserPath);
  return { ...result, tmp };
}
