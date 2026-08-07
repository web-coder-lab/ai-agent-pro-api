/**
 * Phase 45 — Time Travel System
 * Record AI/platform decisions; list history; rollback to checkpoint when linked.
 */

import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { log } from "./logger.js";
import { listCheckpoints, rollbackTo } from "./patchEngine.js";

const DATA = join(process.cwd(), ".data");
const FILE = join(DATA, "decisions.json");
mkdirSync(DATA, { recursive: true });

export type Decision = {
  id: string;
  ts: string;
  actor: string; // agent role / user / system
  action: string;
  reason: string;
  payload?: Record<string, any>;
  checkpointId?: string;
  reversible: boolean;
};

type Store = { decisions: Decision[] };

function load(): Store {
  try {
    if (!existsSync(FILE)) return { decisions: [] };
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return { decisions: [] };
  }
}

function save(s: Store) {
  try {
    writeFileSync(FILE, JSON.stringify({ decisions: s.decisions.slice(0, 500) }, null, 2));
  } catch {
    /* */
  }
}

export function recordDecision(input: {
  actor: string;
  action: string;
  reason: string;
  payload?: Record<string, any>;
  checkpointId?: string;
  reversible?: boolean;
}): Decision {
  const d: Decision = {
    id: randomUUID().slice(0, 12),
    ts: new Date().toISOString(),
    actor: input.actor,
    action: input.action,
    reason: input.reason,
    payload: input.payload,
    checkpointId: input.checkpointId,
    reversible: input.reversible ?? !!input.checkpointId,
  };
  const s = load();
  s.decisions.unshift(d);
  save(s);
  log("info", `Decision ${d.action} by ${d.actor}`, "time-travel");
  return d;
}

export function listDecisions(limit = 50): Decision[] {
  return load().decisions.slice(0, limit);
}

export function getDecision(id: string): Decision | null {
  return load().decisions.find((d) => d.id === id) || null;
}

export async function rollbackDecision(id: string): Promise<{
  ok: boolean;
  detail: string;
  decision?: Decision;
}> {
  const d = getDecision(id);
  if (!d) return { ok: false, detail: "Decision not found" };
  if (!d.reversible || !d.checkpointId) {
    return { ok: false, detail: "Decision is not reversible (no checkpoint)", decision: d };
  }
  try {
    await rollbackTo(d.checkpointId);
    recordDecision({
      actor: "system",
      action: "rollback",
      reason: `Rolled back decision ${d.id} (${d.action})`,
      payload: { rolledBack: d.id, checkpointId: d.checkpointId },
      reversible: false,
    });
    return { ok: true, detail: `Restored checkpoint ${d.checkpointId}`, decision: d };
  } catch (e: any) {
    return { ok: false, detail: e.message || String(e), decision: d };
  }
}

export function timeTravelStats() {
  const all = load().decisions;
  return {
    total: all.length,
    reversible: all.filter((d) => d.reversible).length,
    checkpoints: listCheckpoints().length,
  };
}

/** Convenience wrappers used by other modules */
export const tt = {
  agent: (action: string, reason: string, payload?: any, checkpointId?: string) =>
    recordDecision({ actor: "agent", action, reason, payload, checkpointId }),
  admin: (action: string, reason: string, payload?: any) =>
    recordDecision({ actor: "admin", action, reason, payload, reversible: false }),
};
