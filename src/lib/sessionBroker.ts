/**
 * Phase 36 — Session Broker
 * Global + per-device + per-VPS session limits.
 * Tracks terminal / browser / code-server / custom sessions.
 */

import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { log } from "./logger.js";
import { createSession as createTermSession, destroySession as destroyTermSession, listSessions as listTermSessions } from "./terminal.js";

const DATA = join(process.cwd(), ".data");
const STATE_FILE_PRIMARY = join(DATA, "sessions.json");
const STATE_FILE_FALLBACK = join("/tmp", "ai-agent-pro-sessions.json");
mkdirSync(DATA, { recursive: true });

let _statePath: string | null = null;
function stateFile(): string {
  if (_statePath) return _statePath;
  try {
    mkdirSync(DATA, { recursive: true });
    writeFileSync(STATE_FILE_PRIMARY, JSON.stringify({ limits: DEFAULT_LIMITS, sessions: [] }, null, 2));
    _statePath = STATE_FILE_PRIMARY;
  } catch {
    _statePath = STATE_FILE_FALLBACK;
  }
  return _statePath;
}

export type SessionKind = "terminal" | "browser" | "code-server" | "ssh" | "custom";

export type BrokerSession = {
  id: string;
  kind: SessionKind;
  deviceId: string;
  vpsId: string; // "local" for this machine
  label?: string;
  meta?: Record<string, any>;
  createdAt: string;
  lastActiveAt: string;
  /** link to underlying terminal session id etc */
  refId?: string;
};

export type SessionLimits = {
  globalMax: number;
  perDeviceMax: number;
  perVpsMax: number;
};

const DEFAULT_LIMITS: SessionLimits = {
  globalMax: 200,
  perDeviceMax: 10,
  perVpsMax: 10,
};

type Store = {
  limits: SessionLimits;
  sessions: BrokerSession[];
};

function load(): Store {
  const file = stateFile();
  if (!existsSync(file)) {
    return { limits: { ...DEFAULT_LIMITS }, sessions: [] };
  }
  try {
    const s = JSON.parse(readFileSync(file, "utf8"));
    return {
      limits: { ...DEFAULT_LIMITS, ...(s.limits || {}) },
      sessions: Array.isArray(s.sessions) ? s.sessions : [],
    };
  } catch {
    return { limits: { ...DEFAULT_LIMITS }, sessions: [] };
  }
}

function save(s: Store) {
  try {
    writeFileSync(stateFile(), JSON.stringify(s, null, 2));
  } catch (e) {
    writeFileSync(STATE_FILE_FALLBACK, JSON.stringify(s, null, 2));
  }
}

export function getLimits(): SessionLimits {
  return load().limits;
}

export function setLimits(patch: Partial<SessionLimits>): SessionLimits {
  const s = load();
  s.limits = { ...s.limits, ...patch };
  save(s);
  log("info", `Session limits updated ${JSON.stringify(s.limits)}`, "sessions");
  return s.limits;
}

export function listBrokerSessions(filter?: {
  deviceId?: string;
  vpsId?: string;
  kind?: SessionKind;
}): BrokerSession[] {
  let rows = load().sessions;
  if (filter?.deviceId) rows = rows.filter((x) => x.deviceId === filter.deviceId);
  if (filter?.vpsId) rows = rows.filter((x) => x.vpsId === filter.vpsId);
  if (filter?.kind) rows = rows.filter((x) => x.kind === filter.kind);
  return rows.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
}

function countWhere(s: Store, pred: (x: BrokerSession) => boolean) {
  return s.sessions.filter(pred).length;
}

export type OpenResult =
  | { ok: true; session: BrokerSession }
  | { ok: false; error: string; code: "GLOBAL_LIMIT" | "DEVICE_LIMIT" | "VPS_LIMIT" };

export function openSession(input: {
  kind: SessionKind;
  deviceId?: string;
  vpsId?: string;
  label?: string;
  meta?: Record<string, any>;
  refId?: string;
}): OpenResult {
  const s = load();
  const deviceId = input.deviceId || "default-device";
  const vpsId = input.vpsId || "local";

  if (s.sessions.length >= s.limits.globalMax) {
    return { ok: false, error: `Global session limit ${s.limits.globalMax}`, code: "GLOBAL_LIMIT" };
  }
  const deviceCount = countWhere(s, (x) => x.deviceId === deviceId);
  if (deviceCount >= s.limits.perDeviceMax) {
    return {
      ok: false,
      error: `Device ${deviceId} limit ${s.limits.perDeviceMax}`,
      code: "DEVICE_LIMIT",
    };
  }
  const vpsCount = countWhere(s, (x) => x.vpsId === vpsId);
  if (vpsCount >= s.limits.perVpsMax) {
    return {
      ok: false,
      error: `VPS ${vpsId} limit ${s.limits.perVpsMax}`,
      code: "VPS_LIMIT",
    };
  }

  let refId = input.refId;
  // auto-create terminal session when kind=terminal and no ref
  if (input.kind === "terminal" && !refId) {
    try {
      const t = createTermSession();
      refId = t.id;
    } catch {
      /* optional */
    }
  }

  const session: BrokerSession = {
    id: randomUUID().slice(0, 12),
    kind: input.kind,
    deviceId,
    vpsId,
    label: input.label || input.kind,
    meta: input.meta,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    refId,
  };
  s.sessions.unshift(session);
  save(s);
  log("info", `Session open ${session.kind} ${session.id} device=${deviceId} vps=${vpsId}`, "sessions");
  return { ok: true, session };
}

export function touchSession(id: string): BrokerSession | null {
  const s = load();
  const row = s.sessions.find((x) => x.id === id);
  if (!row) return null;
  row.lastActiveAt = new Date().toISOString();
  save(s);
  return row;
}

export function closeSession(id: string): boolean {
  const s = load();
  const row = s.sessions.find((x) => x.id === id);
  if (!row) return false;
  if (row.kind === "terminal" && row.refId) {
    try {
      destroyTermSession(row.refId);
    } catch {
      /* */
    }
  }
  s.sessions = s.sessions.filter((x) => x.id !== id);
  save(s);
  log("info", `Session closed ${id}`, "sessions");
  return true;
}

export function closeAll(filter?: { deviceId?: string; vpsId?: string }) {
  const s = load();
  const victims = s.sessions.filter((x) => {
    if (filter?.deviceId && x.deviceId !== filter.deviceId) return false;
    if (filter?.vpsId && x.vpsId !== filter.vpsId) return false;
    return true;
  });
  for (const v of victims) {
    if (v.kind === "terminal" && v.refId) {
      try {
        destroyTermSession(v.refId);
      } catch {
        /* */
      }
    }
  }
  const ids = new Set(victims.map((v) => v.id));
  s.sessions = s.sessions.filter((x) => !ids.has(x.id));
  save(s);
  return { closed: victims.length };
}

/** Drop oldest sessions until under global max (maintenance) */
export function enforceLimits(): { removed: number } {
  const s = load();
  let removed = 0;
  s.sessions.sort((a, b) => a.lastActiveAt.localeCompare(b.lastActiveAt));
  while (s.sessions.length > s.limits.globalMax) {
    const old = s.sessions.shift();
    if (!old) break;
    if (old.kind === "terminal" && old.refId) {
      try {
        destroyTermSession(old.refId);
      } catch {
        /* */
      }
    }
    removed++;
  }
  // per-device / per-vps trim
  const byDevice = new Map<string, BrokerSession[]>();
  const byVps = new Map<string, BrokerSession[]>();
  for (const sess of s.sessions) {
    if (!byDevice.has(sess.deviceId)) byDevice.set(sess.deviceId, []);
    byDevice.get(sess.deviceId)!.push(sess);
    if (!byVps.has(sess.vpsId)) byVps.set(sess.vpsId, []);
    byVps.get(sess.vpsId)!.push(sess);
  }
  const keep = new Set(s.sessions.map((x) => x.id));
  for (const [, list] of byDevice) {
    list.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
    list.slice(s.limits.perDeviceMax).forEach((x) => {
      keep.delete(x.id);
      removed++;
    });
  }
  for (const [, list] of byVps) {
    list.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
    list.slice(s.limits.perVpsMax).forEach((x) => {
      keep.delete(x.id);
      removed++;
    });
  }
  s.sessions = s.sessions.filter((x) => keep.has(x.id));
  save(s);
  return { removed };
}

export function sessionStats() {
  const s = load();
  const byKind: Record<string, number> = {};
  const byDevice: Record<string, number> = {};
  const byVps: Record<string, number> = {};
  for (const x of s.sessions) {
    byKind[x.kind] = (byKind[x.kind] || 0) + 1;
    byDevice[x.deviceId] = (byDevice[x.deviceId] || 0) + 1;
    byVps[x.vpsId] = (byVps[x.vpsId] || 0) + 1;
  }
  return {
    limits: s.limits,
    total: s.sessions.length,
    byKind,
    byDevice,
    byVps,
    terminalUnderlying: listTermSessions().length,
  };
}
