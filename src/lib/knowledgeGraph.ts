/**
 * Phase 28 — Knowledge Graph v1
 * Map files ↔ imports, APIs, and simple dependencies inside the workspace.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import { join, relative, dirname, extname } from "path";
import { WORKSPACE } from "./codeRunner.js";
import { listAllFiles } from "./fileManager.js";
import { log } from "./logger.js";

const DATA = join(process.cwd(), ".data");
const GRAPH_FILE = join(DATA, "knowledge-graph.json");
mkdirSync(DATA, { recursive: true });

export type NodeType = "file" | "api" | "module" | "package" | "db";

export type KGNode = {
  id: string;
  type: NodeType;
  label: string;
  meta?: Record<string, any>;
};

export type KGEdge = {
  from: string;
  to: string;
  relation: "imports" | "calls" | "defines" | "uses" | "depends";
};

export type KnowledgeGraph = {
  builtAt: string;
  nodes: KGNode[];
  edges: KGEdge[];
  stats: { files: number; imports: number; apis: number; packages: number };
};

function nodeId(type: NodeType, label: string) {
  return `${type}:${label}`;
}

const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".rb", ".php",
  ".json", ".md", ".html", ".css",
]);

function readTextLimited(abs: string, max = 200_000): string | null {
  try {
    const st = statSync(abs);
    if (st.size > max) return null;
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

/** Resolve relative import to workspace path guess */
function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null; // package
  const base = join(WORKSPACE, dirname(fromFile), spec);
  const tries = ["", ".ts", ".js", ".tsx", ".jsx", ".json", "/index.ts", "/index.js"];
  for (const t of tries) {
    const p = base + t;
    if (existsSync(p)) {
      return relative(WORKSPACE, p).replace(/\\/g, "/");
    }
  }
  return relative(WORKSPACE, base).replace(/\\/g, "/");
}

function extractJsImports(content: string): { specs: string[]; apis: string[] } {
  const specs: string[] = [];
  const apis: string[] = [];
  const importRe = /(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
  let m;
  while ((m = importRe.exec(content))) {
    specs.push(m[1] || m[2]);
  }
  // Express-style routes
  const routeRe = /\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  while ((m = routeRe.exec(content))) {
    apis.push(`${m[1].toUpperCase()} ${m[2]}`);
  }
  // app.get("/api/...")
  const appRe = /app\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  while ((m = appRe.exec(content))) {
    apis.push(`${m[1].toUpperCase()} ${m[2]}`);
  }
  return { specs, apis };
}

function extractPyImports(content: string): string[] {
  const specs: string[] = [];
  const re = /(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/g;
  let m;
  while ((m = re.exec(content))) {
    specs.push((m[1] || m[2] || "").split(".")[0]);
  }
  return specs.filter(Boolean);
}

function extractPackageJsonDeps(content: string): string[] {
  try {
    const j = JSON.parse(content);
    return [
      ...Object.keys(j.dependencies || {}),
      ...Object.keys(j.devDependencies || {}),
    ];
  } catch {
    return [];
  }
}

export async function buildGraph(): Promise<KnowledgeGraph> {
  const files = await listAllFiles(".");
  const nodes = new Map<string, KGNode>();
  const edges: KGEdge[] = [];
  let importCount = 0;
  let apiCount = 0;
  let pkgCount = 0;

  const addNode = (type: NodeType, label: string, meta?: any) => {
    const id = nodeId(type, label);
    if (!nodes.has(id)) nodes.set(id, { id, type, label, meta });
    return id;
  };

  for (const rel of files) {
    const ext = extname(rel).toLowerCase();
    if (!TEXT_EXT.has(ext) && !rel.endsWith("package.json") && !rel.endsWith("requirements.txt")) {
      continue;
    }
    // skip huge trees
    if (rel.includes("node_modules") || rel.includes(".python")) continue;

    const fileId = addNode("file", rel, { ext });
    const abs = join(WORKSPACE, rel);
    const content = readTextLimited(abs);
    if (!content) continue;

    if (rel.endsWith("package.json")) {
      for (const dep of extractPackageJsonDeps(content)) {
        const pId = addNode("package", dep);
        edges.push({ from: fileId, to: pId, relation: "depends" });
        pkgCount++;
      }
      continue;
    }

    if (rel.endsWith("requirements.txt")) {
      for (const line of content.split("\n")) {
        const name = line.trim().split(/[><=!~]/)[0].trim();
        if (!name || name.startsWith("#")) continue;
        const pId = addNode("package", name);
        edges.push({ from: fileId, to: pId, relation: "depends" });
        pkgCount++;
      }
      continue;
    }

    if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
      const { specs, apis } = extractJsImports(content);
      for (const spec of specs) {
        if (spec.startsWith(".") || spec.startsWith("/")) {
          const resolved = resolveImport(rel, spec) || spec;
          const toId = addNode("file", resolved);
          edges.push({ from: fileId, to: toId, relation: "imports" });
        } else {
          const mod = spec.split("/")[0];
          const toId = addNode("module", mod);
          edges.push({ from: fileId, to: toId, relation: "imports" });
        }
        importCount++;
      }
      for (const api of apis) {
        const aId = addNode("api", api);
        edges.push({ from: fileId, to: aId, relation: "defines" });
        apiCount++;
      }
      // db usage hint
      if (/\b(from ['\"].*db|mongoose|prisma|sqlite|postgres)\b/i.test(content)) {
        const dId = addNode("db", "database");
        edges.push({ from: fileId, to: dId, relation: "uses" });
      }
    }

    if (ext === ".py") {
      for (const spec of extractPyImports(content)) {
        const toId = addNode("module", spec);
        edges.push({ from: fileId, to: toId, relation: "imports" });
        importCount++;
      }
    }
  }

  const graph: KnowledgeGraph = {
    builtAt: new Date().toISOString(),
    nodes: [...nodes.values()],
    edges,
    stats: {
      files: [...nodes.values()].filter((n) => n.type === "file").length,
      imports: importCount,
      apis: apiCount,
      packages: pkgCount,
    },
  };

  writeFileSync(GRAPH_FILE, JSON.stringify(graph, null, 2));
  log("info", `KG built: ${graph.nodes.length} nodes, ${graph.edges.length} edges`, "kg");
  return graph;
}

export function loadGraph(): KnowledgeGraph | null {
  if (!existsSync(GRAPH_FILE)) return null;
  try {
    return JSON.parse(readFileSync(GRAPH_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function getGraphOrEmpty(): KnowledgeGraph {
  return (
    loadGraph() || {
      builtAt: "",
      nodes: [],
      edges: [],
      stats: { files: 0, imports: 0, apis: 0, packages: 0 },
    }
  );
}

export function queryGraph(opts: {
  type?: NodeType;
  q?: string;
  around?: string;
  limit?: number;
}) {
  const g = getGraphOrEmpty();
  const limit = opts.limit || 50;
  let nodes = g.nodes;

  if (opts.type) nodes = nodes.filter((n) => n.type === opts.type);
  if (opts.q) {
    const q = opts.q.toLowerCase();
    nodes = nodes.filter((n) => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q));
  }

  if (opts.around) {
    const id = opts.around.includes(":") ? opts.around : null;
    const label = opts.around;
    const center = g.nodes.find((n) => n.id === id || n.label === label || n.id.endsWith(label));
    if (center) {
      const related = new Set<string>([center.id]);
      for (const e of g.edges) {
        if (e.from === center.id) related.add(e.to);
        if (e.to === center.id) related.add(e.from);
      }
      nodes = g.nodes.filter((n) => related.has(n.id));
      const edges = g.edges.filter((e) => related.has(e.from) && related.has(e.to));
      return { nodes: nodes.slice(0, limit), edges, center: center.id };
    }
  }

  const ids = new Set(nodes.slice(0, limit).map((n) => n.id));
  const edges = g.edges.filter((e) => ids.has(e.from) || ids.has(e.to)).slice(0, limit * 3);
  return { nodes: nodes.slice(0, limit), edges };
}

export function graphSummary() {
  const g = getGraphOrEmpty();
  const apis = g.nodes.filter((n) => n.type === "api").slice(0, 30).map((n) => n.label);
  const packages = g.nodes.filter((n) => n.type === "package").slice(0, 30).map((n) => n.label);
  return {
    builtAt: g.builtAt,
    stats: g.stats,
    nodeCount: g.nodes.length,
    edgeCount: g.edges.length,
    sampleApis: apis,
    samplePackages: packages,
  };
}
