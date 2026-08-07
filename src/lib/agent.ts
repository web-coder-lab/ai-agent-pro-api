/**
 * Phase 19 — Chat + Plan + Build agent modes
 */

import OpenAI from "openai";
import { TOOL_DEFINITIONS, dispatchTool, type ToolResult } from "./tools.js";
import db from "../db/schema.js";
import { log } from "./logger.js";
import { routeModel, taskFromMode, recordUsage, budgetOk } from "./modelRouter.js";
import { memoryContext } from "./workspaceMemory.js";

export type AgentMode = "chat" | "plan" | "build" | "ask";

const BASE_CAPABILITIES = `You are AI Agent Pro — an autonomous coding agent with FULL CONTROL of this platform.

Tools available:
- execute_code (many languages)
- shell_command, install_package
- read_file, write_file, list_files, delete_file, mkdir
- remember / recall, web_search
- workspace_info, list_languages`;

const MODE_PROMPTS: Record<AgentMode, string> = {
  chat: `${BASE_CAPABILITIES}

MODE: CHAT
Answer helpfully. Use tools only when needed to verify or fetch real data.
Keep answers concise.`,

  plan: `${BASE_CAPABILITIES}

MODE: PLAN (do NOT execute tools yet)
1. Analyze the user request.
2. If anything is ambiguous, ask clarifying questions first (numbered).
3. Otherwise output a structured plan ONLY:

## Plan
**Goal:** ...
**Steps:**
1. ...
2. ...
**Risks:** ...
**Ready:** yes/no

Do NOT call tools in PLAN mode. Do NOT write files. Planning only.`,

  build: `${BASE_CAPABILITIES}

MODE: BUILD
Execute the task using tools. Prefer action over explanation.
Chain tools until done. Summarize real results only — never invent output.
If the request is critically ambiguous, ask ONE clarifying question instead of guessing.`,

  ask: `${BASE_CAPABILITIES}

MODE: ASK (clarify ambiguity)
Ask focused clarifying questions. Do not execute tools unless required to formulate better questions.
End with a short recommended default if the user does not answer.`,
};

function systemFor(mode: AgentMode): string {
  const base = MODE_PROMPTS[mode] || MODE_PROMPTS.chat;
  const mem = memoryContext("default", 2500);
  if (!mem.trim()) return base;
  return base + "\n\n--- WORKSPACE MEMORY (authoritative project facts) ---\n" + mem;
}

export type AgentEvent =
  | { event: "status"; data: { message: string } }
  | { event: "tool_call"; data: ToolResult }
  | { event: "plan"; data: { content: string } }
  | { event: "chunk"; data: { text: string } }
  | { event: "done"; data: { content: string; toolCalls: ToolResult[]; iterations: number; mode: AgentMode } }
  | { event: "error"; data: { message: string } };

// In-memory last plans per conversation (also saved as messages)
const lastPlans = new Map<number, string>();

export function getLastPlan(convId: number): string | null {
  return lastPlans.get(convId) || null;
}

function makeClient(provider: any): OpenAI {
  const baseURL =
    provider.base_url ||
    (provider.type === "groq"
      ? "https://api.groq.com/openai/v1"
      : provider.type === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : undefined);

  return new OpenAI({
    apiKey: provider.api_key,
    baseURL,
    defaultHeaders:
      provider.type === "openrouter"
        ? { "HTTP-Referer": "https://ai-agent-pro.local", "X-Title": "AI Agent Pro" }
        : undefined,
  });
}

export async function simpleChat(
  convId: number,
  userContent: string,
  opts: { model?: string; providerId?: number; mode?: AgentMode } = {}
): Promise<{ content: string; tokensUsed: number; model?: string; mode: AgentMode }> {
  const mode: AgentMode = opts.mode || "chat";
  db.addMessage(convId, "user", userContent);

  const budget = budgetOk();
  if (!budget.ok) {
    const msg = budget.reason || "Budget exceeded";
    db.addMessage(convId, "assistant", msg);
    db.touchConversation(convId);
    return { content: msg, tokensUsed: 0, mode };
  }

  const pick = routeModel(taskFromMode(mode), { model: opts.model, providerId: opts.providerId });
  const provider = pick.providerId ? db.getProvider(pick.providerId) : db.getActiveProvider();
  const apiKey = pick.apiKey || provider?.api_key;

  if (!apiKey && pick.providerType !== "ollama") {
    const msg =
      "No AI provider configured. Open Settings or Accounts and add an API key.";
    db.addMessage(convId, "assistant", msg);
    db.touchConversation(convId);
    return { content: msg, tokensUsed: 0, mode };
  }

  const client = makeClient({
    ...(provider || {}),
    type: pick.providerType || provider?.type,
    api_key: apiKey,
    base_url: pick.baseURL || provider?.base_url,
  });
  const model = pick.model || opts.model || provider?.default_model || "gpt-4o-mini";
  log("info", `Router: ${pick.reason} → ${pick.providerType}/${model}`, "router");
  const history = db.getMessages(convId, 30);

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemFor(mode) },
      ...history.map((m: any) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    ],
  });

  const content = completion.choices[0]?.message?.content || "Empty response";
  const tokensUsed = completion.usage?.total_tokens || 0;
  db.addMessage(convId, "assistant", content, model, tokensUsed);
  db.touchConversation(convId);

  if (mode === "plan") lastPlans.set(convId, content);
  recordUsage(tokensUsed);

  return { content, tokensUsed, model, mode };
}

export async function runAgentLoop(
  convId: number,
  userContent: string,
  opts: {
    model?: string;
    providerId?: number;
    maxIterations?: number;
    mode?: AgentMode;
    onEvent?: (ev: AgentEvent) => void;
  } = {}
): Promise<{ content: string; toolCalls: ToolResult[]; iterations: number; mode: AgentMode }> {
  const emit = (ev: AgentEvent) => opts.onEvent?.(ev);
  const mode: AgentMode = opts.mode || "build";

  db.addMessage(convId, "user", userContent);

  const budget = budgetOk();
  if (!budget.ok) {
    const msg = budget.reason || "Budget exceeded";
    db.addMessage(convId, "assistant", msg);
    db.touchConversation(convId);
    emit({ event: "done", data: { content: msg, toolCalls: [], iterations: 0, mode } });
    return { content: msg, toolCalls: [], iterations: 0, mode };
  }

  const pick = routeModel(taskFromMode(mode), { model: opts.model, providerId: opts.providerId });
  const provider = pick.providerId ? db.getProvider(pick.providerId) : db.getActiveProvider();
  const apiKey = pick.apiKey || provider?.api_key;

  if (!apiKey && pick.providerType !== "ollama") {
    const msg = "No AI provider with API key configured. Add one in Settings or Accounts.";
    db.addMessage(convId, "assistant", msg);
    db.touchConversation(convId);
    emit({ event: "done", data: { content: msg, toolCalls: [], iterations: 0, mode } });
    return { content: msg, toolCalls: [], iterations: 0, mode };
  }

  const client = makeClient({
    ...(provider || {}),
    type: pick.providerType || provider?.type,
    api_key: apiKey,
    base_url: pick.baseURL || provider?.base_url,
  });
  const model = pick.model || opts.model || provider?.default_model || "gpt-4o-mini";
  log("info", `Router: ${pick.reason} → ${pick.providerType}/${model}`, "router");
  const systemPrompt = systemFor(mode);

  // PLAN or ASK: no tools — single completion
  if (mode === "plan" || mode === "ask") {
    emit({ event: "status", data: { message: mode === "plan" ? "Planning…" : "Clarifying…" } });
    try {
      const history = db.getMessages(convId, 40);
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...history.map((m: any) => ({ role: m.role, content: m.content })),
        ],
      });
      const content = completion.choices[0]?.message?.content || "";
      if (mode === "plan") {
        lastPlans.set(convId, content);
        emit({ event: "plan", data: { content } });
      }
      db.addMessage(convId, "assistant", content, model);
      db.touchConversation(convId);
      emit({ event: "done", data: { content, toolCalls: [], iterations: 1, mode } });
      return { content, toolCalls: [], iterations: 1, mode };
    } catch (err: any) {
      const message = err.message || String(err);
      emit({ event: "error", data: { message } });
      db.addMessage(convId, "assistant", `Error: ${message}`);
      return { content: `Error: ${message}`, toolCalls: [], iterations: 0, mode };
    }
  }

  // BUILD / CHAT with tools
  const maxIter = opts.maxIterations ?? (mode === "build" ? 12 : 8);
  const history = db.getMessages(convId, 40);
  const messages: any[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m: any) => ({ role: m.role, content: m.content })),
  ];

  const allToolCalls: ToolResult[] = [];
  let iterations = 0;
  let finalContent = "";

  emit({ event: "status", data: { message: mode === "build" ? "Building…" : "Thinking…" } });
  log("agent", `Agent loop mode=${mode}`, "agent");

  try {
    while (iterations < maxIter) {
      iterations++;
      emit({ event: "status", data: { message: `Step ${iterations}/${maxIter}` } });

      const completion = await client.chat.completions.create({
        model,
        messages,
        tools: TOOL_DEFINITIONS as any,
        tool_choice: mode === "build" ? "auto" : "auto",
      });

      const choice = completion.choices[0];
      if (!choice) break;

      messages.push(choice.message);

      const toolCalls = choice.message.tool_calls;
      if (!toolCalls?.length) {
        finalContent = choice.message.content || "";
        break;
      }

      for (const tc of toolCalls) {
        if (tc.type !== "function") continue;
        // Groq sometimes returns name with args glued on — keep only legal tool id
        let toolName = String(tc.function?.name || "").trim().split(/[\s\[{(]/)[0];
        if (!toolName) continue;
        let args: Record<string, any> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }
        // rewrite cleaned name on the message for API consistency
        try {
          (tc as any).function.name = toolName;
        } catch { /* */ }

        emit({ event: "status", data: { message: `Tool: ${toolName}` } });
        const result = await dispatchTool(toolName, args);
        allToolCalls.push(result);
        emit({ event: "tool_call", data: result });
        log("agent", `tool ${toolName} ${result.error ? "ERR" : "ok"}`, "agent");

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result.error
            ? `Error: ${result.error}`
            : JSON.stringify(result.result ?? result, null, 2).slice(0, 12000),
        });
      }
    }

    if (!finalContent) {
      messages.push({
        role: "user",
        content: "Give your final answer based on tool results. Be concise.",
      });
      const final = await client.chat.completions.create({
        model,
        messages,
        max_tokens: 2048,
      });
      finalContent =
        final.choices[0]?.message?.content ||
        "Reached maximum tool steps. Partial work may be complete.";
    }

    db.addMessage(convId, "assistant", finalContent, model);
    db.touchConversation(convId);

    emit({
      event: "done",
      data: { content: finalContent, toolCalls: allToolCalls, iterations, mode },
    });

    return { content: finalContent, toolCalls: allToolCalls, iterations, mode };
  } catch (err: any) {
    const message = err.message || String(err);
    emit({ event: "error", data: { message } });
    db.addMessage(convId, "assistant", `Error: ${message}`);
    db.touchConversation(convId);
    return { content: `Error: ${message}`, toolCalls: allToolCalls, iterations, mode };
  }
}

/** Execute the last plan in BUILD mode */
export async function executePlan(
  convId: number,
  opts: {
    model?: string;
    providerId?: number;
    onEvent?: (ev: AgentEvent) => void;
  } = {}
) {
  const plan = lastPlans.get(convId);
  const prompt = plan
    ? `Execute this approved plan now. Use tools. Do not re-plan.\n\n${plan}`
    : `Execute the plan from the previous assistant message. Use tools. Do not re-plan.`;
  return runAgentLoop(convId, prompt, { ...opts, mode: "build" });
}
