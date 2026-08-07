/**
 * Phase 43 — Emergency Response AI
 * Detect incidents, analyze logs/metrics, propose safe recovery, gate dangerous actions.
 */

import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { log, getLogs } from "./logger.js";
import { collectMetrics, evaluateAlerts, type HostMetrics } from "./infraMonitor.js";
import { listVps, checkVps } from "./vpsBroker.js";
import { createInfraSnapshot } from "./infraMonitor.js";
import { addEntry } from "./workspaceMemory.js";
import { createTask } from "./taskQueue.js";

const DATA = join(process.cwd(), ".data");
const INCIDENTS = join(DATA, "incidents.json");
mkdirSync(DATA, { recursive: true });

export type IncidentSeverity = "info" | "warn" | "critical";
export type IncidentStatus = "open" | "mitigating" | "resolved" | "needs_approval";

export type RecoveryAction = {
  id: string;
  title: string;
  risk: "safe" | "moderate" | "dangerous";
  requiresApproval: boolean;
  commandHint: string;
  autoRunnable: boolean;
};

export type Incident = {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  source: string;
  signals: string[];
  rootCauseGuess: string;
  actions: RecoveryAction[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  notes: string[];
};

type Store = { incidents: Incident[] };

function load(): Store {
  try {
    if (!existsSync(INCIDENTS)) return { incidents: [] };
    return JSON.parse(readFileSync(INCIDENTS, "utf8"));
  } catch {
    return { incidents: [] };
  }
}

function save(s: Store) {
  try {
    writeFileSync(INCIDENTS, JSON.stringify(s, null, 2));
  } catch {
    /* */
  }
}

export function listIncidents(status?: IncidentStatus): Incident[] {
  let rows = load().incidents;
  if (status) rows = rows.filter((i) => i.status === status);
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getIncident(id: string): Incident | null {
  return load().incidents.find((i) => i.id === id) || null;
}

function buildActions(kind: string): RecoveryAction[] {
  const base: RecoveryAction[] = [
    {
      id: "snap",
      title: "Take emergency snapshot",
      risk: "safe",
      requiresApproval: false,
      commandHint: "POST /api/infra/snapshot",
      autoRunnable: true,
    },
    {
      id: "logs",
      title: "Collect recent error logs",
      risk: "safe",
      requiresApproval: false,
      commandHint: "inspect logger buffer",
      autoRunnable: true,
    },
  ];

  if (kind === "high_memory" || kind === "high_load") {
    base.push({
      id: "restart_app",
      title: "Restart app processes (pm2/docker compose)",
      risk: "moderate",
      requiresApproval: true,
      commandHint: "pm2 restart all | docker compose restart",
      autoRunnable: false,
    });
  }
  if (kind === "disk") {
    base.push({
      id: "clean_tmp",
      title: "Clear safe temp caches (workspace .cache)",
      risk: "moderate",
      requiresApproval: true,
      commandHint: "rm -rf workspace/.cache/*",
      autoRunnable: false,
    });
  }
  if (kind === "health_down") {
    base.push({
      id: "start_server",
      title: "Start application server",
      risk: "moderate",
      requiresApproval: true,
      commandHint: "npm start",
      autoRunnable: false,
    });
  }
  base.push({
    id: "reboot",
    title: "Reboot host",
    risk: "dangerous",
    requiresApproval: true,
    commandHint: "sudo reboot",
    autoRunnable: false,
  });
  return base;
}

export function openIncident(input: {
  title: string;
  severity: IncidentSeverity;
  source: string;
  signals: string[];
  rootCauseGuess: string;
  kind?: string;
}): Incident {
  const incident: Incident = {
    id: randomUUID().slice(0, 12),
    title: input.title,
    severity: input.severity,
    status: "open",
    source: input.source,
    signals: input.signals,
    rootCauseGuess: input.rootCauseGuess,
    actions: buildActions(input.kind || "generic"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notes: [],
  };
  const s = load();
  s.incidents.unshift(incident);
  save(s);

  addEntry("default", {
    section: "bugs",
    title: `incident:${incident.title}`.slice(0, 80),
    content: `${incident.rootCauseGuess}\n${incident.signals.join("; ")}`,
    tags: ["incident", incident.severity],
  });
  createTask({
    title: `Incident ${incident.severity}: ${incident.title}`,
    type: "agent_note",
    payload: { incidentId: incident.id },
  });
  log("warn", `Incident opened ${incident.id}: ${incident.title}`, "emergency");
  return incident;
}

/** Probe health + metrics + logs → open incidents if needed */
export async function scanEmergencies(): Promise<{
  metrics: HostMetrics;
  alerts: ReturnType<typeof evaluateAlerts>;
  healthOk: boolean;
  opened: Incident[];
  existingOpen: number;
}> {
  const metrics = await collectMetrics();
  const alerts = evaluateAlerts(metrics);
  let healthOk = false;
  try {
    const r = await fetch("http://127.0.0.1:3000/api/health", {
      signal: AbortSignal.timeout(2500),
    });
    healthOk = r.ok;
  } catch {
    healthOk = false;
  }

  const logs = getLogs({ limit: 50 });
  const errorLogs = logs.filter((l) => l.level === "error");

  const opened: Incident[] = [];
  const openRows = listIncidents("open");

  // avoid duplicate titles within open set
  const hasOpen = (title: string) => openRows.some((i) => i.title === title) || opened.some((i) => i.title === title);

  for (const a of alerts) {
    if (a.level === "critical" && a.message.startsWith("Memory") && !hasOpen("Critical memory pressure")) {
      opened.push(
        openIncident({
          title: "Critical memory pressure",
          severity: "critical",
          source: "infra-metrics",
          signals: [a.message, `load=${metrics.cpu.load1}`],
          rootCauseGuess: "Host memory usage exceeded critical threshold",
          kind: "high_memory",
        })
      );
    }
    if (a.level === "critical" && a.message.startsWith("Disk") && !hasOpen("Critical disk space")) {
      opened.push(
        openIncident({
          title: "Critical disk space",
          severity: "critical",
          source: "infra-metrics",
          signals: [a.message],
          rootCauseGuess: "Disk usage exceeded critical threshold",
          kind: "disk",
        })
      );
    }
    if (a.level === "critical" && a.message.startsWith("Load") && !hasOpen("Critical CPU load")) {
      opened.push(
        openIncident({
          title: "Critical CPU load",
          severity: "critical",
          source: "infra-metrics",
          signals: [a.message],
          rootCauseGuess: "Load average high relative to core count",
          kind: "high_load",
        })
      );
    }
  }

  if (!healthOk && !hasOpen("API health endpoint down")) {
    opened.push(
      openIncident({
        title: "API health endpoint down",
        severity: "critical",
        source: "health-check",
        signals: ["GET /api/health failed"],
        rootCauseGuess: "Application server not responding on port 3000",
        kind: "health_down",
      })
    );
  }

  if (errorLogs.length >= 10 && !hasOpen("Error log burst")) {
    opened.push(
      openIncident({
        title: "Error log burst",
        severity: "warn",
        source: "logger",
        signals: errorLogs.slice(0, 5).map((e) => e.message.slice(0, 80)),
        rootCauseGuess: "Elevated error rate in application logs",
        kind: "generic",
      })
    );
  }

  return {
    metrics,
    alerts,
    healthOk,
    opened,
    existingOpen: listIncidents("open").length,
  };
}

/** Run safe auto actions for an incident */
export async function mitigateIncident(id: string): Promise<Incident> {
  const s = load();
  const inc = s.incidents.find((i) => i.id === id);
  if (!inc) throw new Error("Incident not found");

  inc.status = "mitigating";
  inc.updatedAt = new Date().toISOString();

  for (const action of inc.actions.filter((a) => a.autoRunnable && !a.requiresApproval)) {
    try {
      if (action.id === "snap") {
        const snap = await createInfraSnapshot(`incident-${id}`);
        inc.notes.push(`snapshot:${snap.id}`);
      } else if (action.id === "logs") {
        const errs = getLogs({ limit: 20 }).filter((l) => l.level === "error" || l.level === "warn");
        inc.notes.push(`logs_captured:${errs.length}`);
      }
    } catch (e: any) {
      inc.notes.push(`action_fail:${action.id}:${e.message}`);
    }
  }

  const needsApproval = inc.actions.some((a) => a.requiresApproval && a.risk !== "safe");
  inc.status = needsApproval ? "needs_approval" : "mitigating";
  inc.updatedAt = new Date().toISOString();
  save(s);
  log("info", `Incident mitigate ${id} → ${inc.status}`, "emergency");
  return inc;
}

export function approveAction(
  incidentId: string,
  actionId: string,
  approved: boolean,
  note?: string
): Incident {
  const s = load();
  const inc = s.incidents.find((i) => i.id === incidentId);
  if (!inc) throw new Error("Incident not found");
  inc.notes.push(
    `${approved ? "approved" : "rejected"}:${actionId}${note ? ":" + note : ""}`
  );
  if (approved) {
    inc.notes.push(`manual_exec_required:${actionId}`);
    // Still do not auto-run dangerous commands
  }
  inc.updatedAt = new Date().toISOString();
  if (approved && actionId === "resolve") {
    inc.status = "resolved";
    inc.resolvedAt = inc.updatedAt;
  }
  save(s);
  return inc;
}

export function resolveIncident(id: string, note?: string): Incident {
  const s = load();
  const inc = s.incidents.find((i) => i.id === id);
  if (!inc) throw new Error("Incident not found");
  inc.status = "resolved";
  inc.resolvedAt = new Date().toISOString();
  inc.updatedAt = inc.resolvedAt;
  if (note) inc.notes.push(note);
  save(s);
  return inc;
}

export function emergencyStats() {
  const all = load().incidents;
  return {
    total: all.length,
    open: all.filter((i) => i.status === "open").length,
    needs_approval: all.filter((i) => i.status === "needs_approval").length,
    resolved: all.filter((i) => i.status === "resolved").length,
  };
}
