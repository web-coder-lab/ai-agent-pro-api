/**
 * Phase 34 — Browser Automation / Research Agent
 * Fetch pages, extract text, multi-source research reports.
 * Uses fetch (always) + optional headless Chrome when available.
 */

import { spawn, execFileSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { log } from "./logger.js";
import { addEntry } from "./workspaceMemory.js";
import { writeWorkspaceFile } from "./fileManager.js";

const DATA = join(process.cwd(), ".data", "browser");
const REPORTS = join(DATA, "reports");
mkdirSync(REPORTS, { recursive: true });

export type BrowserTab = {
  id: string;
  url: string;
  title: string;
  fetchedAt: string;
  status: number;
  textPreview: string;
  htmlPath?: string;
};

const tabs = new Map<string, BrowserTab>();

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripHtml(m[1]).slice(0, 200) : "";
}

export async function openUrl(
  url: string,
  opts?: { maxBytes?: number; timeoutMs?: number }
): Promise<BrowserTab> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Only http(s) URLs allowed");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs || 20000);
  const maxBytes = opts?.maxBytes || 1_500_000;

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "AI-Agent-Pro-Research/1.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.length;
          if (total > maxBytes) break;
          chunks.push(value);
        }
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const html = buf.toString("utf8");
    const text = stripHtml(html).slice(0, 50_000);
    const title = extractTitle(html) || url;

    const id = randomUUID().slice(0, 10);
    const htmlPath = join(DATA, `${id}.html`);
    mkdirSync(DATA, { recursive: true });
    writeFileSync(htmlPath, html.slice(0, maxBytes));

    const tab: BrowserTab = {
      id,
      url: res.url || url,
      title,
      fetchedAt: new Date().toISOString(),
      status: res.status,
      textPreview: text.slice(0, 2000),
      htmlPath,
    };
    tabs.set(id, tab);
    // keep last 30 tabs
    if (tabs.size > 30) {
      const first = tabs.keys().next().value;
      if (first) tabs.delete(first);
    }
    log("info", `Browser open ${res.status} ${url}`, "browser");
    return tab;
  } finally {
    clearTimeout(timeout);
  }
}

export function listTabs(): BrowserTab[] {
  return [...tabs.values()].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
}

export function getTab(id: string): BrowserTab | null {
  return tabs.get(id) || null;
}

export function readTabText(id: string, max = 15000): string {
  const tab = tabs.get(id);
  if (!tab?.htmlPath || !existsSync(tab.htmlPath)) {
    return tab?.textPreview || "";
  }
  const html = readFileSync(tab.htmlPath, "utf8");
  return stripHtml(html).slice(0, max);
}

/** Search-like: open several URLs and summarize text */
export async function researchTopic(
  topic: string,
  urls?: string[]
): Promise<{
  topic: string;
  sources: { url: string; title: string; status: number; excerpt: string }[];
  reportPath: string;
  reportId: string;
}> {
  const seedUrls =
    urls && urls.length
      ? urls
      : [
          `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(topic)}&go=Go`,
          `https://github.com/search?q=${encodeURIComponent(topic)}&type=repositories`,
          `https://stackoverflow.com/search?q=${encodeURIComponent(topic)}`,
        ];

  const sources: { url: string; title: string; status: number; excerpt: string }[] = [];

  for (const url of seedUrls.slice(0, 5)) {
    try {
      const tab = await openUrl(url);
      sources.push({
        url: tab.url,
        title: tab.title,
        status: tab.status,
        excerpt: tab.textPreview.slice(0, 800),
      });
    } catch (e: any) {
      sources.push({
        url,
        title: "error",
        status: 0,
        excerpt: e.message || String(e),
      });
    }
  }

  const reportId = randomUUID().slice(0, 10);
  const md = [
    `# Research Report: ${topic}`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `## Sources`,
    ...sources.map(
      (s, i) =>
        `### ${i + 1}. ${s.title}\n- URL: ${s.url}\n- Status: ${s.status}\n\n${s.excerpt}\n`
    ),
    `## Notes`,
    `- Automated fetch-based research (Phase 34).`,
    `- Verify critical facts before production use.`,
    ``,
  ].join("\n");

  const reportPath = join(REPORTS, `${reportId}.md`);
  writeFileSync(reportPath, md);
  await writeWorkspaceFile(`research/${topic.replace(/[^\w.-]+/g, "_").slice(0, 40)}.md`, md);

  addEntry("default", {
    section: "team_notes",
    title: `research:${topic.slice(0, 60)}`,
    content: `Report ${reportId} with ${sources.length} sources`,
    tags: ["research", "browser"],
  });

  log("info", `Research report ${reportId} for ${topic}`, "browser");
  return { topic, sources, reportPath, reportId };
}

export function listReports(limit = 20) {
  if (!existsSync(REPORTS)) return [];
  return readdirSync(REPORTS)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const path = join(REPORTS, f);
      return {
        id: f.replace(/\.md$/, ""),
        path,
        name: f,
      };
    })
    .slice(0, limit);
}

export function readReport(id: string): string {
  const path = join(REPORTS, `${id}.md`);
  if (!existsSync(path)) throw new Error("Report not found");
  return readFileSync(path, "utf8");
}

/** Optional headless Chrome dump (if binary present) */
export function chromeAvailable(): string | null {
  for (const c of ["google-chrome", "chromium", "chromium-browser"]) {
    try {
      const out = execFileSync("which", [c], { encoding: "utf8" }).trim();
      if (out) return out;
    } catch {
      /* */
    }
  }
  return null;
}

export async function chromeDumpText(url: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  const bin = chromeAvailable();
  if (!bin) return { ok: false, error: "Chrome/Chromium not found" };
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "Invalid URL" };

  const outFile = join(DATA, `chrome-${Date.now()}.html`);
  mkdirSync(DATA, { recursive: true });

  return new Promise((resolve) => {
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--dump-dom",
      url,
    ];
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, error: "chrome timeout" });
    }, 25000);
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
      if (stdout.length > 2_000_000) stdout = stdout.slice(0, 2_000_000);
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout) {
        resolve({ ok: false, error: stderr.slice(0, 300) || `exit ${code}` });
        return;
      }
      try {
        writeFileSync(outFile, stdout);
      } catch {
        /* */
      }
      resolve({ ok: true, text: stripHtml(stdout).slice(0, 30000) });
    });
  });
}

export function browserStatus() {
  return {
    tabs: tabs.size,
    reports: listReports().length,
    chrome: chromeAvailable(),
    mode: "fetch + optional headless chrome",
  };
}
