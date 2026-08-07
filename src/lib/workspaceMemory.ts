/**
 * Phase 27 — Workspace Memory
 * Permanent per-project brain: architecture, APIs, style, tasks, bugs, notes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { log } from "./logger.js";
import { WORKSPACE } from "./codeRunner.js";

const MEM_ROOT = join(process.cwd(), ".data", "workspace-memory");
mkdirSync(MEM_ROOT, { recursive: true });

export type MemorySection =
  | "architecture"
  | "apis"
  | "coding_style"
  | "pending_tasks"
  | "bugs"
  | "team_notes"
  | "decisions"
  | "custom";

export type MemoryEntry = {
  id: string;
  section: MemorySection;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectMemory = {
  projectId: string;
  name: string;
  summary: string;
  entries: MemoryEntry[];
  updatedAt: string;
};

function projectPath(projectId: string) {
  const safe = projectId.replace(/[^a-zA-Z0-9._-]/g, "_") || "default";
  return join(MEM_ROOT, `${safe}.json`);
}

function loadProject(projectId: string): ProjectMemory {
  const path = projectPath(projectId);
  if (!existsSync(path)) {
    return {
      projectId,
      name: projectId,
      summary: "",
      entries: [],
      updatedAt: new Date().toISOString(),
    };
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {
      projectId,
      name: projectId,
      summary: "",
      entries: [],
      updatedAt: new Date().toISOString(),
    };
  }
}

function saveProject(mem: ProjectMemory) {
  mem.updatedAt = new Date().toISOString();
  writeFileSync(projectPath(mem.projectId), JSON.stringify(mem, null, 2));
}

export function listProjects(): { projectId: string; name: string; entries: number; updatedAt: string }[] {
  if (!existsSync(MEM_ROOT)) return [];
  return readdirSync(MEM_ROOT)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const m = JSON.parse(readFileSync(join(MEM_ROOT, f), "utf8")) as ProjectMemory;
        return {
          projectId: m.projectId,
          name: m.name,
          entries: m.entries.length,
          updatedAt: m.updatedAt,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as any[];
}

export function getMemory(projectId = "default"): ProjectMemory {
  return loadProject(projectId);
}

export function setSummary(projectId: string, summary: string, name?: string) {
  const m = loadProject(projectId);
  m.summary = summary;
  if (name) m.name = name;
  saveProject(m);
  log("info", `Memory summary updated: ${projectId}`, "memory");
  return m;
}

export function addEntry(
  projectId: string,
  input: {
    section: MemorySection;
    title: string;
    content: string;
    tags?: string[];
  }
): MemoryEntry {
  const m = loadProject(projectId);
  const entry: MemoryEntry = {
    id: randomUUID().slice(0, 10),
    section: input.section || "custom",
    title: input.title,
    content: input.content,
    tags: input.tags || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  m.entries.unshift(entry);
  // cap 500 entries per project
  if (m.entries.length > 500) m.entries = m.entries.slice(0, 500);
  saveProject(m);
  log("info", `Memory +${entry.section}: ${entry.title}`, "memory");
  return entry;
}

export function updateEntry(
  projectId: string,
  entryId: string,
  patch: Partial<Pick<MemoryEntry, "title" | "content" | "tags" | "section">>
): MemoryEntry | null {
  const m = loadProject(projectId);
  const e = m.entries.find((x) => x.id === entryId);
  if (!e) return null;
  if (patch.title !== undefined) e.title = patch.title;
  if (patch.content !== undefined) e.content = patch.content;
  if (patch.tags) e.tags = patch.tags;
  if (patch.section) e.section = patch.section;
  e.updatedAt = new Date().toISOString();
  saveProject(m);
  return e;
}

export function deleteEntry(projectId: string, entryId: string): boolean {
  const m = loadProject(projectId);
  const before = m.entries.length;
  m.entries = m.entries.filter((x) => x.id !== entryId);
  saveProject(m);
  return m.entries.length < before;
}

export function searchMemory(
  projectId: string,
  q: string,
  section?: MemorySection
): MemoryEntry[] {
  const m = loadProject(projectId);
  const needle = (q || "").toLowerCase();
  return m.entries.filter((e) => {
    if (section && e.section !== section) return false;
    if (!needle) return true;
    return (
      e.title.toLowerCase().includes(needle) ||
      e.content.toLowerCase().includes(needle) ||
      e.tags.some((t) => t.toLowerCase().includes(needle))
    );
  });
}

/** Compact context string for agent system prompt injection */
export function memoryContext(projectId = "default", maxChars = 3000): string {
  const m = loadProject(projectId);
  const parts: string[] = [];
  if (m.summary) parts.push(`## Project summary\n${m.summary}`);

  const bySection = (section: MemorySection, limit: number) => {
    const items = m.entries.filter((e) => e.section === section).slice(0, limit);
    if (!items.length) return;
    parts.push(
      `## ${section}\n` +
        items.map((e) => `- **${e.title}**: ${e.content.slice(0, 280)}`).join("\n")
    );
  };

  bySection("architecture", 5);
  bySection("apis", 8);
  bySection("coding_style", 5);
  bySection("pending_tasks", 8);
  bySection("bugs", 5);
  bySection("team_notes", 5);
  bySection("decisions", 5);

  let out = parts.join("\n\n");
  if (out.length > maxChars) out = out.slice(0, maxChars) + "\n…";
  return out;
}

/** Seed default project from workspace hints */
export function ensureDefaultProject() {
  const m = loadProject("default");
  if (!m.name || m.name === "default") {
    m.name = "workspace";
  }
  if (!m.summary) {
    m.summary = `AI Agent Pro workspace at ${WORKSPACE}`;
  }
  if (!m.entries.find((e) => e.title === "platform")) {
    m.entries.push({
      id: randomUUID().slice(0, 10),
      section: "architecture",
      title: "platform",
      content: "AI Agent Pro — agent platform with tools, IDE panels, vault, router (phases 1–27).",
      tags: ["meta"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  saveProject(m);
  return m;
}

ensureDefaultProject();
