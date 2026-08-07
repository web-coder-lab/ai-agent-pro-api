/**
 * Phase 44 — Self-Improvement Agent
 * Scan workspace for slow patterns, duplication, refactor proposals (suggestions only).
 */

import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync } from "fs";
import { join, extname } from "path";
import { WORKSPACE } from "./codeRunner.js";
import { listAllFiles, readWorkspaceFile } from "./fileManager.js";
import { addEntry } from "./workspaceMemory.js";
import { log } from "./logger.js";

const DATA = join(process.cwd(), ".data");
const REPORTS = join(DATA, "self-improve");
mkdirSync(REPORTS, { recursive: true });

export type FindingKind =
  | "large_file"
  | "duplicate_hash"
  | "todo_debt"
  | "console_noise"
  | "sync_fs_risk"
  | "missing_test"
  | "complexity_hint";

export type Finding = {
  id: string;
  kind: FindingKind;
  severity: "info" | "suggest" | "important";
  file?: string;
  title: string;
  detail: string;
  proposal: string;
};

export type ImproveReport = {
  id: string;
  createdAt: string;
  findings: Finding[];
  summary: string;
};

const TEXT_EXT = new Set([
  ".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".rs", ".java",
  ".md", ".json", ".yml", ".yaml",
]);

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return String(h);
}

export async function runSelfImprove(opts?: { maxFiles?: number }): Promise<ImproveReport> {
  const maxFiles = opts?.maxFiles || 150;
  const files = (await listAllFiles(".")).filter((f) => {
    if (f.includes("node_modules") || f.includes(".python")) return false;
    return TEXT_EXT.has(extname(f).toLowerCase()) || !extname(f);
  }).slice(0, maxFiles);

  const findings: Finding[] = [];
  const hashes = new Map<string, string[]>();

  for (const rel of files) {
    const abs = join(WORKSPACE, rel);
    let size = 0;
    try {
      size = statSync(abs).size;
    } catch {
      continue;
    }

    if (size > 80_000) {
      findings.push({
        id: randomUUID().slice(0, 8),
        kind: "large_file",
        severity: "suggest",
        file: rel,
        title: `Large file (${Math.round(size / 1024)}KB)`,
        detail: `${rel} is ${size} bytes`,
        proposal: "Split into modules; extract helpers; lazy-load heavy sections",
      });
    }

    if (size > 200_000) continue; // skip read

    let content = "";
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      continue;
    }

    // duplicate content hash (short files)
    if (content.length > 40 && content.length < 20_000) {
      const h = simpleHash(content.replace(/\s+/g, " ").trim());
      if (!hashes.has(h)) hashes.set(h, []);
      hashes.get(h)!.push(rel);
    }

    const todoCount = (content.match(/\bTODO\b|\bFIXME\b/g) || []).length;
    if (todoCount >= 3) {
      findings.push({
        id: randomUUID().slice(0, 8),
        kind: "todo_debt",
        severity: "info",
        file: rel,
        title: `${todoCount} TODO/FIXME markers`,
        detail: rel,
        proposal: "Convert TODOs into tracked tasks or resolve",
      });
    }

    const consoleCount = (content.match(/console\.(log|debug|warn)/g) || []).length;
    if (consoleCount >= 8 && /\.(ts|js)$/.test(rel)) {
      findings.push({
        id: randomUUID().slice(0, 8),
        kind: "console_noise",
        severity: "info",
        file: rel,
        title: `${consoleCount} console.* calls`,
        detail: rel,
        proposal: "Use structured logger; gate debug logs behind env flag",
      });
    }

    // naive complexity: too many functions in one file
    const fnCount = (content.match(/\bfunction\b|\b=>\s*\{/g) || []).length;
    if (fnCount >= 40) {
      findings.push({
        id: randomUUID().slice(0, 8),
        kind: "complexity_hint",
        severity: "suggest",
        file: rel,
        title: `High function density (~${fnCount})`,
        detail: rel,
        proposal: "Extract classes/modules; reduce file responsibility",
      });
    }

    if (/\breadFileSync\b|\bwriteFileSync\b/.test(content) && /\.(ts|js)$/.test(rel)) {
      // only flag if many sync calls
      const syncN = (content.match(/readFileSync|writeFileSync/g) || []).length;
      if (syncN >= 6) {
        findings.push({
          id: randomUUID().slice(0, 8),
          kind: "sync_fs_risk",
          severity: "suggest",
          file: rel,
          title: `${syncN} sync fs calls`,
          detail: rel,
          proposal: "Prefer async fs/promises on request path to avoid blocking event loop",
        });
      }
    }
  }

  for (const [, group] of hashes) {
    if (group.length >= 2) {
      findings.push({
        id: randomUUID().slice(0, 8),
        kind: "duplicate_hash",
        severity: "important",
        title: "Possible duplicate files",
        detail: group.slice(0, 5).join(" · "),
        proposal: "Deduplicate shared code into a single module",
      });
    }
  }

  // missing tests heuristic
  const hasCode = files.some((f) => /\.(ts|js|py)$/.test(f) && !/test|spec/.test(f));
  const hasTest = files.some((f) => /test_|_test\.|\.test\.|\.spec\./.test(f));
  if (hasCode && !hasTest) {
    findings.push({
      id: randomUUID().slice(0, 8),
      kind: "missing_test",
      severity: "suggest",
      title: "No obvious test files in workspace sample",
      detail: "Scanned workspace paths",
      proposal: "Add unit/integration tests for critical paths",
    });
  }

  // sort severity
  const rank = { important: 0, suggest: 1, info: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);

  const report: ImproveReport = {
    id: randomUUID().slice(0, 10),
    createdAt: new Date().toISOString(),
    findings: findings.slice(0, 50),
    summary: `${findings.length} findings across ${files.length} files`,
  };

  writeFileSync(join(REPORTS, `${report.id}.json`), JSON.stringify(report, null, 2));

  addEntry("default", {
    section: "team_notes",
    title: `self-improve:${report.id}`,
    content: report.summary + "\n" + report.findings.slice(0, 5).map((f) => `- ${f.title}`).join("\n"),
    tags: ["self-improve"],
  });

  log("info", `Self-improve ${report.id}: ${report.summary}`, "self-improve");
  return report;
}

export function listImproveReports(limit = 20) {
  if (!existsSync(REPORTS)) return [];
  return readdirSync(REPORTS)
    .filter((f) => f.endsWith(".json"))
    .slice(0, limit)
    .map((f) => {
      try {
        const r = JSON.parse(readFileSync(join(REPORTS, f), "utf8")) as ImproveReport;
        return { id: r.id, createdAt: r.createdAt, summary: r.summary, count: r.findings.length };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}


export function getImproveReport(id: string): ImproveReport | null {
  const p = join(REPORTS, `${id}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
