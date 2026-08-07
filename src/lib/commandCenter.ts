/**
 * Phase 46 — AI Command Center
 * Single aggregated view: health, agents, sessions, VPS, infra, missions, incidents.
 */

import { collectMetrics, evaluateAlerts } from "./infraMonitor.js";
import { listVps, vpsStats } from "./vpsBroker.js";
import { listLocalAiNodes, clusterStats } from "./localAiCluster.js";
import { sessionStats, listBrokerSessions } from "./sessionBroker.js";
import { listMissions, missionStats } from "./company.js";
import { listIncidents, emergencyStats } from "./emergency.js";
import { listWorkers, workerStats } from "./workers.js";
import { listTwins, twinStats } from "./digitalTwin.js";
import { timeTravelStats } from "./timeTravel.js";
import { brokerStats } from "./credentialBroker.js";
import { listTasks } from "./taskQueue.js";
import { getLogs } from "./logger.js";
import { listImproveReports } from "./selfImprove.js";
import { detectTools } from "./deployAgents.js";

export async function commandCenterSnapshot() {
  let healthOk = false;
  try {
    const r = await fetch("http://127.0.0.1:3000/api/health", {
      signal: AbortSignal.timeout(2000),
    });
    healthOk = r.ok;
  } catch {
    healthOk = false;
  }

  const metrics = await collectMetrics();
  const alerts = evaluateAlerts(metrics);

  return {
    at: new Date().toISOString(),
    healthOk,
    world: {
      vps: listVps().map((v) => ({
        id: v.id,
        name: v.name,
        host: v.host,
        status: v.status,
      })),
      localAi: listLocalAiNodes().map((n) => ({
        id: n.id,
        name: n.name,
        vpsId: n.vpsId,
        status: n.status,
      })),
      sessions: listBrokerSessions().slice(0, 20),
    },
    stats: {
      vps: vpsStats(),
      localAi: clusterStats(),
      sessions: sessionStats(),
      missions: missionStats(),
      emergency: emergencyStats(),
      workers: workerStats(),
      twins: twinStats(),
      timeTravel: timeTravelStats(),
      credentials: brokerStats(),
      tasks: { total: listTasks().length, pending: listTasks({ status: "pending" as any }).length },
    },
    infra: {
      metrics,
      alerts,
    },
    missions: listMissions().slice(0, 8).map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
    })),
    incidents: listIncidents().slice(0, 8).map((i) => ({
      id: i.id,
      title: i.title,
      severity: i.severity,
      status: i.status,
    })),
    workers: listWorkers().map((w) => ({
      id: w.id,
      kind: w.kind,
      status: w.status,
    })),
    recentLogs: getLogs({ limit: 15 }).map((l) => ({
      level: l.level,
      source: l.source,
      message: l.message.slice(0, 120),
      ts: l.ts,
    })),
    improveReports: listImproveReports(5),
    deployTools: await detectTools(),
  };
}

export function commandCenterSummary(snap: Awaited<ReturnType<typeof commandCenterSnapshot>>) {
  return {
    healthOk: snap.healthOk,
    alerts: snap.infra.alerts.length,
    openIncidents: snap.stats.emergency.open,
    openMissions: snap.missions.filter((m) => !["done", "cancelled"].includes(m.status)).length,
    vpsOnline: snap.stats.vps.online,
    sessions: snap.stats.sessions.total,
    workersRunning: snap.workers.filter((w) => w.status === "running").length,
  };
}
