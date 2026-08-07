/**
 * Phase 21 — Patch Engine
 * Propose file patches → review → apply/reject
 * Checkpoints + rollback
 */

import {
  readWorkspaceFile, writeWorkspaceFile, listAllFiles, safePath,
} from "./fileManager.js";
import { log } from "./logger.js";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { WORKSPACE } from "./codeRunner.js";

export type PatchHunk = {
  path: string;
  action: "create" | "update" | "delete";
  before?: string;
  after?: string;
};

export type PatchProposal = {
  id: string;
  title: string;
  status: "pending" | "applied" | "rejected";
  hunks: PatchHunk[];
  createdAt: string;
  decidedAt?: string;
};

export type Checkpoint = {
  id: string;
  label: string;
  createdAt: string;
  files: number;
  dir: string;
};

const patches = new Map<string, PatchProposal>();
const CP_ROOT = join("/tmp", "ai-agent-checkpoints");
mkdirSync(CP_ROOT, { recursive: true });

export function listPatches(status?: string): PatchProposal[] {
  let all = [...patches.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
  if (status) all = all.filter((p) => p.status === status);
  return all;
}

export function getPatch(id: string): PatchProposal | null {
  return patches.get(id) || null;
}

export function proposePatch(input: {
  title: string;
  hunks: PatchHunk[];
}): PatchProposal {
  const p: PatchProposal = {
    id: randomUUID().slice(0, 10),
    title: input.title,
    status: "pending",
    hunks: input.hunks,
    createdAt: new Date().toISOString(),
  };
  patches.set(p.id, p);
  log("info", `Patch proposed: ${p.title} (${p.hunks.length} hunks)`, "patch");
  return p;
}

/** Capture current content for paths into hunks.before */
export async function enrichHunks(hunks: PatchHunk[]): Promise<PatchHunk[]> {
  const out: PatchHunk[] = [];
  for (const h of hunks) {
    let before: string | undefined;
    try {
      const r = await readWorkspaceFile(h.path);
      before = r.content;
    } catch {
      before = undefined;
    }
    out.push({
      ...h,
      action: h.action || (before === undefined ? "create" : h.after === undefined ? "delete" : "update"),
      before: h.before !== undefined ? h.before : before,
    });
  }
  return out;
}

export async function applyPatch(id: string): Promise<PatchProposal> {
  const p = patches.get(id);
  if (!p) throw new Error("Patch not found");
  if (p.status !== "pending") throw new Error(`Patch already ${p.status}`);

  // auto checkpoint before apply
  await createCheckpoint(`before-patch-${id}`);

  for (const h of p.hunks) {
    if (h.action === "delete") {
      try {
        const { deleteWorkspacePath } = await import("./fileManager.js");
        await deleteWorkspacePath(h.path);
      } catch (e: any) {
        log("warn", `delete ${h.path}: ${e.message}`, "patch");
      }
    } else {
      await writeWorkspaceFile(h.path, h.after ?? "");
    }
  }

  p.status = "applied";
  p.decidedAt = new Date().toISOString();
  patches.set(id, p);
  log("info", `Patch applied: ${p.title}`, "patch");
  return p;
}

export function rejectPatch(id: string): PatchProposal {
  const p = patches.get(id);
  if (!p) throw new Error("Patch not found");
  if (p.status !== "pending") throw new Error(`Patch already ${p.status}`);
  p.status = "rejected";
  p.decidedAt = new Date().toISOString();
  patches.set(id, p);
  log("info", `Patch rejected: ${p.title}`, "patch");
  return p;
}

export async function createCheckpoint(label = "manual"): Promise<Checkpoint> {
  const id = randomUUID().slice(0, 10);
  const dir = join(CP_ROOT, id);
  mkdirSync(dir, { recursive: true });

  const files = await listAllFiles(".");
  let count = 0;
  const manifest: string[] = [];
  for (const rel of files) {
    try {
      // skip huge / binary-ish
      const { content } = await readWorkspaceFile(rel);
      if (content.length > 1_500_000) continue;
      const dest = join(dir, rel);
      mkdirSync(join(dest, ".."), { recursive: true });
      writeFileSync(dest, content, "utf8");
      manifest.push(rel);
      count++;
    } catch {
      /* skip */
    }
  }
  writeFileSync(join(dir, "__manifest__.json"), JSON.stringify({ label, files: manifest }, null, 2));

  const cp: Checkpoint = {
    id,
    label,
    createdAt: new Date().toISOString(),
    files: count,
    dir,
  };
  // index
  const indexPath = join(CP_ROOT, "index.json");
  let index: Checkpoint[] = [];
  if (existsSync(indexPath)) {
    try {
      index = JSON.parse(readFileSync(indexPath, "utf8"));
    } catch {
      index = [];
    }
  }
  index.unshift(cp);
  index = index.slice(0, 30); // keep last 30
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
  log("info", `Checkpoint ${id}: ${count} files`, "patch");
  return cp;
}

export function listCheckpoints(): Checkpoint[] {
  const indexPath = join(CP_ROOT, "index.json");
  if (!existsSync(indexPath)) return [];
  try {
    return JSON.parse(readFileSync(indexPath, "utf8"));
  } catch {
    return [];
  }
}

export async function rollbackTo(checkpointId: string): Promise<{ restored: number }> {
  const dir = join(CP_ROOT, checkpointId);
  const manifestPath = join(dir, "__manifest__.json");
  if (!existsSync(manifestPath)) throw new Error("Checkpoint not found");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const files: string[] = manifest.files || [];

  // safety checkpoint of current state
  await createCheckpoint(`before-rollback-${checkpointId}`);

  let restored = 0;
  for (const rel of files) {
    const src = join(dir, rel);
    if (!existsSync(src)) continue;
    const content = readFileSync(src, "utf8");
    await writeWorkspaceFile(rel, content);
    restored++;
  }
  log("info", `Rollback to ${checkpointId}: ${restored} files`, "patch");
  return { restored };
}

/** Unified diff text for a patch (display) */
export function patchToDiff(p: PatchProposal): string {
  const lines: string[] = [`# ${p.title}`, `# status: ${p.status}`, ""];
  for (const h of p.hunks) {
    lines.push(`--- a/${h.path}`);
    lines.push(`+++ b/${h.path}`);
    if (h.action === "delete") {
      lines.push("@@ DELETE @@");
      for (const l of (h.before || "").split("\n")) lines.push("-" + l);
    } else if (h.action === "create") {
      lines.push("@@ CREATE @@");
      for (const l of (h.after || "").split("\n")) lines.push("+" + l);
    } else {
      lines.push("@@ UPDATE @@");
      for (const l of (h.before || "").split("\n").slice(0, 40)) lines.push("-" + l);
      for (const l of (h.after || "").split("\n").slice(0, 40)) lines.push("+" + l);
    }
    lines.push("");
  }
  return lines.join("\n");
}
