/**
 * Simple JSON + file based DB (no native modules)
 * Fully real and persistent
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";

const dataDir = join(process.cwd(), ".data");
mkdirSync(dataDir, { recursive: true });
const DB_FILE = join(dataDir, "db.json");

type Row = Record<string, any>;

interface DBShape {
  providers: Row[];
  conversations: Row[];
  messages: Row[];
  agent_memory: Row[];
  execution_logs: Row[];
  _seq: Record<string, number>;
}

function load(): DBShape {
  if (!existsSync(DB_FILE)) {
    return {
      providers: [],
      conversations: [],
      messages: [],
      agent_memory: [],
      execution_logs: [],
      _seq: { providers: 1, conversations: 1, messages: 1, agent_memory: 1, execution_logs: 1 }
    };
  }
  return JSON.parse(readFileSync(DB_FILE, "utf8"));
}

function save(data: DBShape) {
  writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function nextId(table: keyof DBShape["_seq"]) {
  const data = load();
  const id = data._seq[table] || 1;
  data._seq[table] = id + 1;
  save(data);
  return id;
}

export const db = {
  // Providers
  listProviders() {
    return load().providers.map(p => {
      const { api_key, ...rest } = p as any;
      return {
        ...rest,
        has_api_key: !!(api_key && String(api_key).length > 0),
        api_key_preview: api_key ? `${String(api_key).slice(0, 6)}…` : null,
      };
    });
  },
  createProvider(row: Row) {
    const data = load();
    const id = data._seq.providers++;
    const item = { id, created_at: new Date().toISOString(), is_active: 1, ...row };
    data.providers.push(item);
    save(data);
    const { api_key, ...safe } = item as any;
    return {
      ...safe,
      has_api_key: !!(api_key && String(api_key).length > 0),
      api_key_preview: api_key ? `${String(api_key).slice(0, 6)}…` : null,
    };
  },
  deleteProvider(id: number) {
    const data = load();
    data.providers = data.providers.filter(p => p.id !== id);
    save(data);
  },
  getProvider(id: number) {
    return load().providers.find(p => p.id === id);
  },
  getActiveProvider() {
    return load().providers.find(p => p.is_active);
  },

  // Conversations
  listConversations() {
    const data = load();
    return data.conversations
      .map(c => ({
        ...c,
        message_count: data.messages.filter(m => m.conversation_id === c.id).length
      }))
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  },
  createConversation(row: Row) {
    const data = load();
    const id = data._seq.conversations++;
    const item = {
      id,
      title: row.title || "New Chat",
      provider_id: row.providerId || null,
      model: row.model || null,
      system_prompt: row.systemPrompt || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    data.conversations.push(item);
    save(data);
    return item;
  },
  getConversation(id: number) {
    const data = load();
    const conv = data.conversations.find(c => c.id === id);
    if (!conv) return null;
    const messages = data.messages.filter(m => m.conversation_id === id).sort((a, b) => a.id - b.id);
    return { ...conv, messages };
  },
  deleteConversation(id: number) {
    const data = load();
    data.conversations = data.conversations.filter(c => c.id !== id);
    data.messages = data.messages.filter(m => m.conversation_id !== id);
    save(data);
  },
  touchConversation(id: number) {
    const data = load();
    const c = data.conversations.find(c => c.id === id);
    if (c) {
      c.updated_at = new Date().toISOString();
      save(data);
    }
  },

  // Messages
  addMessage(conversationId: number, role: string, content: string, model?: string, tokens?: number) {
    const data = load();
    const id = data._seq.messages++;
    const item = {
      id,
      conversation_id: conversationId,
      role,
      content,
      model: model || null,
      tokens_used: tokens || null,
      created_at: new Date().toISOString()
    };
    data.messages.push(item);
    save(data);
    return item;
  },
  getMessages(conversationId: number, limit = 50) {
    return load().messages
      .filter(m => m.conversation_id === conversationId)
      .sort((a, b) => a.id - b.id)
      .slice(-limit);
  },

  // Memory
  listMemory() {
    return load().agent_memory.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  },
  setMemory(key: string, value: string, category?: string) {
    const data = load();
    const existing = data.agent_memory.find(m => m.key === key);
    if (existing) {
      existing.value = value;
      existing.category = category || existing.category;
      existing.updated_at = new Date().toISOString();
    } else {
      data.agent_memory.push({
        id: data._seq.agent_memory++,
        key,
        value,
        category: category || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
    save(data);
  },
  getMemory(key: string) {
    return load().agent_memory.find(m => m.key === key) || null;
  },
  searchMemory(q: string) {
    const lower = q.toLowerCase();
    return load().agent_memory.filter(m =>
      m.key.toLowerCase().includes(lower) ||
      (m.value || "").toLowerCase().includes(lower) ||
      (m.category || "").toLowerCase().includes(lower)
    );
  },

  // Execution logs
  addExecutionLog(log: Row) {
    const data = load();
    const id = data._seq.execution_logs++;
    data.execution_logs.unshift({
      id,
      ...log,
      created_at: new Date().toISOString()
    });
    // keep last 200
    data.execution_logs = data.execution_logs.slice(0, 200);
    save(data);
  },

  updateConversation(id: number, patch: { title?: string; systemPrompt?: string; model?: string }) {
    const data = load();
    const c = data.conversations.find(c => c.id === id);
    if (!c) return null;
    if (patch.title !== undefined) c.title = patch.title;
    if (patch.systemPrompt !== undefined) c.system_prompt = patch.systemPrompt;
    if (patch.model !== undefined) c.model = patch.model;
    c.updated_at = new Date().toISOString();
    save(data);
    return c;
  },

  // ── Phase 17: DB Manager ────────────────────────────────────
  listTables() {
    const data = load();
    const tables = ["providers", "conversations", "messages", "agent_memory", "execution_logs"] as const;
    return tables.map((name) => ({
      name,
      count: Array.isArray((data as any)[name]) ? (data as any)[name].length : 0,
      nextId: data._seq[name] || 1,
    }));
  },
  getTable(name: string, limit = 100, offset = 0) {
    const data = load();
    const allowed = ["providers", "conversations", "messages", "agent_memory", "execution_logs"];
    if (!allowed.includes(name)) throw new Error("Unknown table: " + name);
    const rows = ((data as any)[name] as Row[]) || [];
    return {
      name,
      total: rows.length,
      rows: rows.slice(offset, offset + limit),
    };
  },
  insertRow(name: string, row: Row) {
    const data = load();
    const allowed = ["providers", "conversations", "messages", "agent_memory", "execution_logs"];
    if (!allowed.includes(name)) throw new Error("Unknown table: " + name);
    const id = (data._seq as any)[name]++;
    const item = { id, created_at: new Date().toISOString(), ...row };
    (data as any)[name].push(item);
    save(data);
    return item;
  },
  deleteRow(name: string, id: number) {
    const data = load();
    const allowed = ["providers", "conversations", "messages", "agent_memory", "execution_logs"];
    if (!allowed.includes(name)) throw new Error("Unknown table: " + name);
    const before = (data as any)[name].length;
    (data as any)[name] = (data as any)[name].filter((r: Row) => r.id !== id);
    save(data);
    return { deleted: before - (data as any)[name].length };
  },
  resetTable(name: string) {
    const data = load();
    const allowed = ["providers", "conversations", "messages", "agent_memory", "execution_logs"];
    if (!allowed.includes(name)) throw new Error("Unknown table: " + name);
    (data as any)[name] = [];
    (data._seq as any)[name] = 1;
    save(data);
    return { ok: true, name };
  },
  resetAll() {
    const empty: DBShape = {
      providers: [],
      conversations: [],
      messages: [],
      agent_memory: [],
      execution_logs: [],
      _seq: { providers: 1, conversations: 1, messages: 1, agent_memory: 1, execution_logs: 1 },
    };
    save(empty);
    return { ok: true };
  },
  /** Initialize empty DB metadata only — never injects fake API providers */
  seedDefaults() {
    const data = load();
    if (!data.agent_memory.find((m) => m.key === "platform")) {
      data.agent_memory.push({
        id: data._seq.agent_memory++,
        key: "platform",
        value: "AI Agent Pro",
        category: "meta",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    save(data);
    return { ok: true, tables: this.listTables(), providers: data.providers.length };
  },
  /** @deprecated use seedDefaults — kept as alias without fake providers */
  seedDemo() {
    return this.seedDefaults();
  },
  backup() {
    const data = load();
    const dir = join(process.cwd(), ".data", "backups");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `backup-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify(data, null, 2));
    return { file, size: Buffer.byteLength(JSON.stringify(data)) };
  },
  stats() {
    const tables = this.listTables();
    return {
      engine: "json-file",
      file: DB_FILE,
      tables,
      totalRows: tables.reduce((n, t) => n + t.count, 0),
    };
  },

  restoreBackup(filePath: string) {
    if (!existsSync(filePath)) throw new Error("Backup not found: " + filePath);
    const raw = readFileSync(filePath, "utf8");
    const data = JSON.parse(raw) as DBShape;
    if (!data._seq || !Array.isArray(data.providers)) throw new Error("Invalid backup format");
    // safety backup current first
    this.backup();
    save(data);
    return { ok: true, tables: this.listTables() };
  },
  listBackups() {
    const dir = join(process.cwd(), ".data", "backups");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f: string) => f.endsWith(".json"))
      .map((f: string) => {
        const fp = join(dir, f);
        const s = statSync(fp);
        return { file: fp, name: f, size: s.size, mtime: s.mtime.toISOString() };
      })
      .sort((a: any, b: any) => (b.mtime || "").localeCompare(a.mtime || ""));
  },
  /** Simple cross-table search */
  queryAll(q: string, limit = 50) {
    const data = load();
    const needle = (q || "").toLowerCase();
    if (!needle) return { results: [] };
    const tables = ["providers", "conversations", "messages", "agent_memory", "execution_logs"] as const;
    const results: { table: string; row: Row }[] = [];
    for (const table of tables) {
      for (const row of (data as any)[table] as Row[]) {
        const blob = JSON.stringify(row).toLowerCase();
        if (blob.includes(needle)) {
          results.push({ table, row });
          if (results.length >= limit) return { results };
        }
      }
    }
    return { results };
  },
  updateRow(name: string, id: number, patch: Row) {
    const data = load();
    const allowed = ["providers", "conversations", "messages", "agent_memory", "execution_logs"];
    if (!allowed.includes(name)) throw new Error("Unknown table: " + name);
    const rows = (data as any)[name] as Row[];
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error("Row not found");
    rows[idx] = { ...rows[idx], ...patch, id };
    save(data);
    return rows[idx];
  },
  listExecutions(limit = 100) {
    return load().execution_logs.slice(0, limit);
  }
};

export default db;
