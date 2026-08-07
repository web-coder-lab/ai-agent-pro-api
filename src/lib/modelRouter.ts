/**
 * Phase 26 — Multi-Model Router
 * Route tasks to best provider/model; fallbacks; simple budgets.
 */

import db from "../db/schema.js";
import { log } from "./logger.js";
import { findCredential, resolveSecret } from "./credentialBroker.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export type TaskKind =
  | "coding"
  | "review"
  | "research"
  | "chat"
  | "fast"
  | "plan"
  | "vision"
  | "local";

export type RoutePick = {
  providerId?: number;
  providerType: string;
  model: string;
  baseURL?: string;
  apiKey?: string;
  reason: string;
  task: TaskKind;
};

type Budget = {
  day: string; // YYYY-MM-DD
  tokensUsed: number;
  requests: number;
  limitTokens: number;
  limitRequests: number;
};

const DATA = join(process.cwd(), ".data");
const BUDGET_FILE = join(DATA, "model-budget.json");
const RULES_FILE = join(DATA, "model-routes.json");
mkdirSync(DATA, { recursive: true });

/** Default task → preferred provider types + model hints */
const DEFAULT_RULES: Record<
  TaskKind,
  { providers: string[]; models: string[] }
> = {
  coding: {
    providers: ["anthropic", "openai", "openrouter", "groq"],
    models: ["claude-sonnet-4-20250514", "gpt-4o", "llama-3.3-70b-versatile"],
  },
  review: {
    providers: ["anthropic", "openai", "openrouter"],
    models: ["claude-sonnet-4-20250514", "gpt-4o"],
  },
  research: {
    providers: ["openrouter", "openai", "groq"],
    models: ["google/gemini-2.0-flash", "gpt-4o-mini"],
  },
  chat: {
    providers: ["groq", "openai", "openrouter"],
    models: ["llama-3.3-70b-versatile", "gpt-4o-mini"],
  },
  fast: {
    providers: ["groq", "openai", "openrouter"],
    models: ["llama-3.1-8b-instant", "gpt-4o-mini"],
  },
  plan: {
    providers: ["anthropic", "openai", "openrouter", "groq"],
    models: ["claude-sonnet-4-20250514", "gpt-4o"],
  },
  vision: {
    providers: ["openai", "openrouter"],
    models: ["gpt-4o", "gpt-4o-mini"],
  },
  local: {
    providers: ["ollama", "local"],
    models: ["llama3.2", "qwen2.5-coder"],
  },
};

function loadRules() {
  if (!existsSync(RULES_FILE)) return DEFAULT_RULES;
  try {
    return { ...DEFAULT_RULES, ...JSON.parse(readFileSync(RULES_FILE, "utf8")) };
  } catch {
    return DEFAULT_RULES;
  }
}

export function getRouteRules() {
  return loadRules();
}

export function setRouteRules(patch: Partial<typeof DEFAULT_RULES>) {
  const next = { ...loadRules(), ...patch };
  writeFileSync(RULES_FILE, JSON.stringify(next, null, 2));
  return next;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function loadBudget(): Budget {
  const d = today();
  if (existsSync(BUDGET_FILE)) {
    try {
      const b = JSON.parse(readFileSync(BUDGET_FILE, "utf8")) as Budget;
      if (b.day === d) return b;
    } catch {
      /* reset */
    }
  }
  return {
    day: d,
    tokensUsed: 0,
    requests: 0,
    limitTokens: 2_000_000,
    limitRequests: 2000,
  };
}

function saveBudget(b: Budget) {
  writeFileSync(BUDGET_FILE, JSON.stringify(b, null, 2));
}

export function getBudget() {
  return loadBudget();
}

export function setBudgetLimits(limits: { limitTokens?: number; limitRequests?: number }) {
  const b = loadBudget();
  if (limits.limitTokens != null) b.limitTokens = limits.limitTokens;
  if (limits.limitRequests != null) b.limitRequests = limits.limitRequests;
  saveBudget(b);
  return b;
}

export function recordUsage(tokens: number) {
  const b = loadBudget();
  b.tokensUsed += tokens || 0;
  b.requests += 1;
  saveBudget(b);
  return b;
}

export function budgetOk(): { ok: boolean; reason?: string } {
  const b = loadBudget();
  if (b.requests >= b.limitRequests) return { ok: false, reason: "Daily request budget exceeded" };
  if (b.tokensUsed >= b.limitTokens) return { ok: false, reason: "Daily token budget exceeded" };
  return { ok: true };
}

function providerApiKey(provider: any): string | undefined {
  if (provider.api_key) return provider.api_key;
  // try vault credential by type
  const type = String(provider.type || "").toLowerCase();
  const map: Record<string, string> = {
    openai: "openai",
    anthropic: "anthropic",
    groq: "groq",
    openrouter: "openrouter",
  };
  const service = map[type];
  if (!service) return undefined;
  const cred = findCredential(service as any);
  if (!cred) return undefined;
  return resolveSecret(cred.id) || undefined;
}

function baseURLFor(type: string, explicit?: string): string | undefined {
  if (explicit) return explicit;
  switch (type) {
    case "groq":
      return "https://api.groq.com/openai/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "ollama":
      return "http://127.0.0.1:11434/v1";
    case "anthropic":
      return "https://api.anthropic.com/v1";
    default:
      return undefined;
  }
}

/**
 * Pick provider+model for a task.
 * Prefer DB providers that have keys; honor task rules; fallback to active provider.
 */
export function routeModel(
  task: TaskKind = "chat",
  opts?: { model?: string; providerId?: number }
): RoutePick {
  const budget = budgetOk();
  if (!budget.ok) {
    log("warn", budget.reason || "budget", "router");
  }

  const rules = loadRules();
  const rule = rules[task] || rules.chat;
  const providers = db.listProviders() as any[];

  // Explicit override
  if (opts?.providerId) {
    const p = db.getProvider(opts.providerId);
    if (p) {
      const key = providerApiKey(p);
      return {
        providerId: p.id,
        providerType: p.type,
        model: opts.model || p.default_model || rule.models[0],
        baseURL: baseURLFor(p.type, p.base_url),
        apiKey: key,
        reason: "explicit providerId",
        task,
      };
    }
  }

  // Prefer providers matching rule order that have a key
  for (const type of rule.providers) {
    const candidates = providers.filter(
      (p) => String(p.type).toLowerCase() === type && (p.api_key || providerApiKey(p))
    );
    // active first
    candidates.sort((a, b) => (b.is_active || 0) - (a.is_active || 0));
    const p = candidates[0];
    if (!p) continue;
    const key = providerApiKey(p);
    if (!key && type !== "ollama") continue;

    let model = opts?.model || p.default_model;
    if (!model || model === "default") {
      model = rule.models[0];
    }
    // if provider has matching preferred model name fragment, use default_model
    if (p.default_model) model = opts?.model || p.default_model;

    return {
      providerId: p.id,
      providerType: p.type,
      model,
      baseURL: baseURLFor(p.type, p.base_url),
      apiKey: key,
      reason: `task=${task} matched provider type ${type}`,
      task,
    };
  }

  // Fallback: any active provider
  const active = db.getActiveProvider() || providers[0];
  if (active) {
    return {
      providerId: active.id,
      providerType: active.type,
      model: opts?.model || active.default_model || rule.models[0] || "gpt-4o-mini",
      baseURL: baseURLFor(active.type, active.base_url),
      apiKey: providerApiKey(active),
      reason: "fallback active provider",
      task,
    };
  }

  return {
    providerType: "none",
    model: opts?.model || "gpt-4o-mini",
    reason: "no providers configured",
    task,
  };
}

/** Map agent mode → task kind */
export function taskFromMode(mode?: string): TaskKind {
  switch (mode) {
    case "build":
      return "coding";
    case "plan":
      return "plan";
    case "ask":
      return "chat";
    case "chat":
      return "chat";
    default:
      return "coding";
  }
}

export function routerStatus() {
  return {
    budget: getBudget(),
    rules: loadRules(),
    providers: (db.listProviders() as any[]).map((p) => ({
      id: p.id,
      type: p.type,
      name: p.name,
      model: p.default_model,
      hasKey: !!(p.api_key || providerApiKey(p)),
      active: !!p.is_active,
    })),
  };
}
