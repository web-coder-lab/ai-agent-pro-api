/**
 * Phase 10 — In-memory console / platform logs
 */
export type LogLevel = "info" | "warn" | "error" | "debug" | "agent" | "exec";

export type LogEntry = {
  id: number;
  ts: string;
  level: LogLevel;
  source: string;
  message: string;
  data?: any;
};

const MAX = 500;
const buffer: LogEntry[] = [];
let seq = 1;

export function log(
  level: LogLevel,
  message: string,
  source = "system",
  data?: any
): LogEntry {
  let safeData = data;
  try {
    if (data !== undefined) {
      const s = JSON.stringify(data);
      safeData = s.length > 4000 ? { _truncated: true, preview: s.slice(0, 4000) } : data;
    }
  } catch {
    safeData = { _unserializable: true };
  }
  const entry: LogEntry = {
    id: seq++,
    ts: new Date().toISOString(),
    level,
    source,
    message: String(message).slice(0, 2000),
    data: safeData,
  };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  return entry;
}

export function getLogs(opts: { limit?: number; filter?: string; level?: string } = {}) {
  let rows = buffer.slice();
  if (opts.level) rows = rows.filter((r) => r.level === opts.level);
  if (opts.filter) {
    const q = opts.filter.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.message.toLowerCase().includes(q) ||
        r.source.toLowerCase().includes(q) ||
        r.level.includes(q)
    );
  }
  const limit = opts.limit ?? 100;
  return rows.slice(-limit).reverse();
}

export function clearLogs() {
  buffer.length = 0;
  return { ok: true };
}

// seed
log("info", "Logger online", "system");
