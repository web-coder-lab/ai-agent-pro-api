/**
 * Phase 35 — Research → Memory + Knowledge Graph
 * Ingest research reports into permanent memory and graph nodes/edges.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { addEntry, searchMemory, memoryContext } from "./workspaceMemory.js";
import { buildGraph, loadGraph, getGraphOrEmpty, type KGNode, type KGEdge } from "./knowledgeGraph.js";
import { listReports, readReport, researchTopic } from "./browserAgent.js";
import { log } from "./logger.js";

const DATA = join(process.cwd(), ".data");
const INGEST_LOG = join(DATA, "research-ingest.json");
mkdirSync(DATA, { recursive: true });

export type IngestRecord = {
  id: string;
  reportId: string;
  topic: string;
  memoryEntryIds: string[];
  graphNodeIds: string[];
  ingestedAt: string;
};

function loadIngestLog(): IngestRecord[] {
  if (!existsSync(INGEST_LOG)) return [];
  try {
    return JSON.parse(readFileSync(INGEST_LOG, "utf8"));
  } catch {
    return [];
  }
}

function saveIngestLog(rows: IngestRecord[]) {
  writeFileSync(INGEST_LOG, JSON.stringify(rows.slice(0, 200), null, 2));
}

/** Parse markdown research report into topic + source blocks */
export function parseReportMarkdown(md: string): {
  topic: string;
  sources: { title: string; url: string; excerpt: string }[];
} {
  const topicMatch = md.match(/^#\s*Research Report:\s*(.+)$/m);
  const topic = topicMatch?.[1]?.trim() || "research";

  const sources: { title: string; url: string; excerpt: string }[] = [];
  const parts = md.split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const lines = part.split("\n");
    const title = (lines[0] || "").replace(/^\d+\.\s*/, "").trim();
    let url = "";
    const body: string[] = [];
    for (const line of lines.slice(1)) {
      const um = line.match(/URL:\s*(https?:\/\/\S+)/i);
      if (um) url = um[1];
      else if (!line.startsWith("- Status:")) body.push(line);
    }
    sources.push({
      title: title || url || "source",
      url,
      excerpt: body.join(" ").trim().slice(0, 1200),
    });
  }
  return { topic, sources };
}

/**
 * Merge research-derived nodes into knowledge graph JSON
 * (without full workspace rescan).
 */
export function mergeResearchIntoGraph(input: {
  topic: string;
  reportId: string;
  sources: { title: string; url: string; excerpt: string }[];
}): { nodeIds: string[]; edgeCount: number } {
  const g = getGraphOrEmpty();
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const edges = [...g.edges];
  const nodeIds: string[] = [];

  const topicId = `module:research:${input.topic.slice(0, 80)}`;
  nodes.set(topicId, {
    id: topicId,
    type: "module",
    label: `research:${input.topic}`,
    meta: { reportId: input.reportId, kind: "research_topic" },
  });
  nodeIds.push(topicId);

  const reportNodeId = `file:research-report:${input.reportId}`;
  nodes.set(reportNodeId, {
    id: reportNodeId,
    type: "file",
    label: `research/${input.reportId}.md`,
    meta: { reportId: input.reportId },
  });
  nodeIds.push(reportNodeId);
  edges.push({ from: reportNodeId, to: topicId, relation: "defines" });

  for (const s of input.sources) {
    if (!s.url) continue;
    const srcId = `module:url:${s.url.slice(0, 120)}`;
    nodes.set(srcId, {
      id: srcId,
      type: "module",
      label: s.title || s.url,
      meta: { url: s.url, excerpt: s.excerpt.slice(0, 200), kind: "web_source" },
    });
    nodeIds.push(srcId);
    edges.push({ from: topicId, to: srcId, relation: "depends" });
    edges.push({ from: reportNodeId, to: srcId, relation: "uses" });
  }

  const next = {
    builtAt: new Date().toISOString(),
    nodes: [...nodes.values()],
    edges,
    stats: {
      files: [...nodes.values()].filter((n) => n.type === "file").length,
      imports: g.stats?.imports || 0,
      apis: g.stats?.apis || 0,
      packages: g.stats?.packages || 0,
    },
  };

  const GRAPH_FILE = join(DATA, "knowledge-graph.json");
  writeFileSync(GRAPH_FILE, JSON.stringify(next, null, 2));
  return { nodeIds, edgeCount: edges.length };
}

/** Full ingest: report markdown → memory entries + KG nodes */
export function ingestReport(
  reportId: string,
  opts?: { projectId?: string }
): IngestRecord {
  const md = readReport(reportId);
  const { topic, sources } = parseReportMarkdown(md);
  const projectId = opts?.projectId || "default";
  const memoryEntryIds: string[] = [];

  // Summary memory
  const summary = addEntry(projectId, {
    section: "team_notes",
    title: `research-report:${topic}`.slice(0, 80),
    content: `Report ${reportId}. Sources: ${sources.length}. Topic: ${topic}`,
    tags: ["research", "ingest", reportId],
  });
  memoryEntryIds.push(summary.id);

  // Per-source memory (cap 5)
  for (const s of sources.slice(0, 5)) {
    const e = addEntry(projectId, {
      section: "apis",
      title: (s.title || s.url || "source").slice(0, 80),
      content: `${s.url}\n\n${s.excerpt}`.slice(0, 1500),
      tags: ["research", "source", reportId],
    });
    memoryEntryIds.push(e.id);
  }

  // Key excerpt as decision/architecture note
  if (sources[0]?.excerpt) {
    const e = addEntry(projectId, {
      section: "architecture",
      title: `insight:${topic}`.slice(0, 80),
      content: sources[0].excerpt.slice(0, 1000),
      tags: ["research", "insight", reportId],
    });
    memoryEntryIds.push(e.id);
  }

  const { nodeIds } = mergeResearchIntoGraph({ topic, reportId, sources });

  const rec: IngestRecord = {
    id: randomUUID().slice(0, 10),
    reportId,
    topic,
    memoryEntryIds,
    graphNodeIds: nodeIds,
    ingestedAt: new Date().toISOString(),
  };
  const logRows = loadIngestLog();
  logRows.unshift(rec);
  saveIngestLog(logRows);
  log("info", `Ingested research ${reportId} → mem ${memoryEntryIds.length} kg ${nodeIds.length}`, "research");
  return rec;
}

/** Research + auto-ingest pipeline */
export async function researchAndIngest(
  topic: string,
  urls?: string[]
): Promise<{
  reportId: string;
  reportPath: string;
  sources: any[];
  ingest: IngestRecord;
  memoryPreview: string;
}> {
  const report = await researchTopic(topic, urls);
  const ingest = ingestReport(report.reportId);
  return {
    reportId: report.reportId,
    reportPath: report.reportPath,
    sources: report.sources,
    ingest,
    memoryPreview: memoryContext("default", 1500),
  };
}

export function listIngests(limit = 30) {
  return loadIngestLog().slice(0, limit);
}

export function findRelatedMemory(topic: string) {
  return searchMemory("default", topic);
}
