/**
 * Phase 42 — Infrastructure AI
 * Host metrics, process restart hooks, workspace backup/snapshot/restore.
 */

import { spawn, execFile } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { log } from "./logger.js";
import { WORKSPACE } from "./codeRunner.js";
import { createCheckpoint } from "./patchEngine.js";

const DATA = join(process.cwd(), ".data");
const METRICS_LOG = join(DATA, "infra-metrics.json");
const SNAP_DIR = join(DATA, "infra-snapshots");
mkdirSync(SNAP_DIR, { recursive: true });

export type HostMetrics = {
  at: string;
  cpu: { load1: number; load5: number; cores: number };
  memory: { totalMb: number; usedMb: number; freeMb: number; usedPct: number };
  disk: { totalGb: number; usedGb: number; availableGb: number; usedPct: number };
  network?: { rxBytes?: number; txBytes?: number };
  gpu?: { available: boolean; detail?: string };
  uptimeSec?: number;
};

function runCmd(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, encoding: "utf8" }, (err, stdout) => {
      if (err) resolve("");
      else resolve(String(stdout || ""));
    });
  });
}

export async function collectMetrics(): Promise<HostMetrics> {
  const at = new Date().toISOString();

  // CPU load
  let load1 = 0, load5 = 0, cores = 1;
  try {
    const loadavg = readFileSync("/proc/loadavg", "utf8").trim().split(/\s+/);
    load1 = parseFloat(loadavg[0]) || 0;
    load5 = parseFloat(loadavg[1]) || 0;
    const cpuinfo = readFileSync("/proc/cpuinfo", "utf8");
    cores = (cpuinfo.match(/^processor/gm) || []).length || 1;
  } catch {
    /* */
  }

  // Memory
  let totalMb = 0, freeMb = 0, usedMb = 0, usedPct = 0;
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf8");
    const get = (k: string) => {
      const m = meminfo.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"));
      return m ? parseInt(m[1], 10) / 1024 : 0;
    };
    totalMb = get("MemTotal");
    const avail = get("MemAvailable") || get("MemFree");
    freeMb = avail;
    usedMb = Math.max(0, totalMb - freeMb);
    usedPct = totalMb ? Math.round((usedMb / totalMb) * 1000) / 10 : 0;
  } catch {
    /* */
  }

  // Disk (workspace /)
  let totalGb = 0, usedGb = 0, availableGb = 0, diskPct = 0;
  const df = await runCmd("df", ["-B1", WORKSPACE]);
  const lines = df.trim().split("\n");
  if (lines.length >= 2) {
    const parts = lines[lines.length - 1].split(/\s+/);
    // Filesystem size used avail use% mount
    const size = parseInt(parts[1], 10) || 0;
    const used = parseInt(parts[2], 10) || 0;
    const avail = parseInt(parts[3], 10) || 0;
    totalGb = Math.round((size / 1e9) * 100) / 100;
    usedGb = Math.round((used / 1e9) * 100) / 100;
    availableGb = Math.round((avail / 1e9) * 100) / 100;
    diskPct = size ? Math.round((used / size) * 1000) / 10 : 0;
  }

  // Network rough from /proc/net/dev
  let rxBytes = 0, txBytes = 0;
  try {
    const net = readFileSync("/proc/net/dev", "utf8");
    for (const line of net.split("\n").slice(2)) {
      const p = line.trim().split(/\s+/);
      if (p.length < 10) continue;
      if (p[0].startsWith("lo")) continue;
      rxBytes += parseInt(p[1], 10) || 0;
      txBytes += parseInt(p[9], 10) || 0;
    }
  } catch {
    /* */
  }

  // GPU
  let gpu: HostMetrics["gpu"] = { available: false };
  const nvidia = await runCmd("bash", ["-lc", "command -v nvidia-smi >/dev/null && nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader || true"]);
  if (nvidia.trim()) {
    gpu = { available: true, detail: nvidia.trim().slice(0, 200) };
  }

  let uptimeSec = 0;
  try {
    uptimeSec = parseFloat(readFileSync("/proc/uptime", "utf8").split(" ")[0]) || 0;
  } catch {
    /* */
  }

  const metrics: HostMetrics = {
    at,
    cpu: { load1, load5, cores },
    memory: { totalMb: Math.round(totalMb), usedMb: Math.round(usedMb), freeMb: Math.round(freeMb), usedPct },
    disk: { totalGb, usedGb, availableGb, usedPct: diskPct },
    network: { rxBytes, txBytes },
    gpu,
    uptimeSec: Math.round(uptimeSec),
  };

  // append history
  try {
    let hist: HostMetrics[] = [];
    if (existsSync(METRICS_LOG)) hist = JSON.parse(readFileSync(METRICS_LOG, "utf8"));
    hist.unshift(metrics);
    writeFileSync(METRICS_LOG, JSON.stringify(hist.slice(0, 120), null, 2));
  } catch {
    /* */
  }

  return metrics;
}

export function metricsHistory(limit = 30): HostMetrics[] {
  try {
    if (!existsSync(METRICS_LOG)) return [];
    return JSON.parse(readFileSync(METRICS_LOG, "utf8")).slice(0, limit);
  } catch {
    return [];
  }
}

export type Alert = { level: "info" | "warn" | "critical"; message: string };

export function evaluateAlerts(m: HostMetrics): Alert[] {
  const alerts: Alert[] = [];
  if (m.memory.usedPct >= 90) alerts.push({ level: "critical", message: `Memory ${m.memory.usedPct}%` });
  else if (m.memory.usedPct >= 80) alerts.push({ level: "warn", message: `Memory ${m.memory.usedPct}%` });
  if (m.disk.usedPct >= 90) alerts.push({ level: "critical", message: `Disk ${m.disk.usedPct}%` });
  else if (m.disk.usedPct >= 80) alerts.push({ level: "warn", message: `Disk ${m.disk.usedPct}%` });
  const loadPerCore = m.cpu.cores ? m.cpu.load1 / m.cpu.cores : m.cpu.load1;
  if (loadPerCore >= 2) alerts.push({ level: "critical", message: `Load ${m.cpu.load1} on ${m.cpu.cores} cores` });
  else if (loadPerCore >= 1.2) alerts.push({ level: "warn", message: `Load ${m.cpu.load1}` });
  return alerts;
}

/** Soft restart: not kill -9 host; restart tracked app processes if any */
export async function softRestartHint(): Promise<{ actions: string[] }> {
  return {
    actions: [
      "pm2 restart all",
      "docker compose restart",
      "systemctl restart <service>",
      "Avoid: reboot without admin approval",
    ],
  };
}

/** Snapshot workspace into .data/infra-snapshots */
export async function createInfraSnapshot(label?: string): Promise<{ id: string; path: string }> {
  try {
    await createCheckpoint(`infra-snap-${label || "auto"}`);
  } catch {
    /* */
  }
  const id = randomUUID().slice(0, 10);
  const dest = join(SNAP_DIR, id);
  mkdirSync(dest, { recursive: true });

  // tar workspace (best effort)
  await new Promise<void>((resolve) => {
    const child = spawn(
      "tar",
      ["-czf", join(dest, "workspace.tar.gz"), "-C", WORKSPACE, "."],
      { stdio: "ignore" }
    );
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 30000);
    child.on("close", () => {
      clearTimeout(t);
      resolve();
    });
    child.on("error", () => {
      clearTimeout(t);
      resolve();
    });
  });

  const meta = {
    id,
    label: label || "snapshot",
    createdAt: new Date().toISOString(),
    workspace: WORKSPACE,
  };
  writeFileSync(join(dest, "meta.json"), JSON.stringify(meta, null, 2));
  log("info", `Infra snapshot ${id}`, "infra");
  return { id, path: dest };
}

export function listInfraSnapshots() {
  if (!existsSync(SNAP_DIR)) return [];
  return readdirSync(SNAP_DIR)
    .map((id) => {
      const metaPath = join(SNAP_DIR, id, "meta.json");
      if (!existsSync(metaPath)) return null;
      try {
        return JSON.parse(readFileSync(metaPath, "utf8"));
      } catch {
        return { id };
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

/** Restore is gated — extracts to workspace/.restore-<id> not overwrite by default */
export async function restoreSnapshotPreview(id: string): Promise<{ ok: boolean; target: string; detail: string }> {
  const archive = join(SNAP_DIR, id, "workspace.tar.gz");
  if (!existsSync(archive)) return { ok: false, target: "", detail: "snapshot archive missing" };
  const target = join(WORKSPACE, `.restore-${id}`);
  mkdirSync(target, { recursive: true });
  await new Promise<void>((resolve) => {
    const child = spawn("tar", ["-xzf", archive, "-C", target], { stdio: "ignore" });
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
  return { ok: true, target: `.restore-${id}`, detail: "Extracted to preview folder — manual promote required" };
}

export async function infraStatus() {
  const metrics = await collectMetrics();
  return {
    metrics,
    alerts: evaluateAlerts(metrics),
    snapshots: listInfraSnapshots().slice(0, 10),
    restart: await softRestartHint(),
  };
}
