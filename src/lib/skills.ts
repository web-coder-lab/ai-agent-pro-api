/**
 * Phase 22 — Skills, Plugins, Hooks, Workflows
 */

import { log } from "./logger.js";
import { randomUUID } from "crypto";
import { dispatchTool, TOOL_DEFINITIONS, type ToolResult } from "./tools.js";
import { createTask } from "./taskQueue.js";
import { proposePatch, enrichHunks } from "./patchEngine.js";

// ── Skills (reusable recipes) ─────────────────────────────────

export type Skill = {
  id: string;
  name: string;
  description: string;
  // ordered steps: tool calls or notes
  steps: { tool?: string; args?: Record<string, any>; note?: string }[];
  tags?: string[];
};

const builtinSkills: Skill[] = [
  {
    id: "scaffold-python",
    name: "Scaffold Python file",
    description: "Create a basic Python main.py and run it",
    tags: ["python", "scaffold"],
    steps: [
      {
        tool: "write_file",
        args: {
          path: "main.py",
          content: 'def main():\n    print("hello from skill")\n\nif __name__ == "__main__":\n    main()\n',
        },
      },
      { tool: "execute_code", args: { language: "python", code: 'print("skill scaffold ok")' } },
    ],
  },
  {
    id: "workspace-report",
    name: "Workspace report",
    description: "List files and languages available",
    tags: ["inspect"],
    steps: [
      { tool: "workspace_info", args: {} },
      { tool: "list_languages", args: {} },
    ],
  },
  {
    id: "git-snapshot",
    name: "Git snapshot note",
    description: "Queue a shell task for git status",
    tags: ["git"],
    steps: [
      { note: "Enqueue git status" },
      {
        tool: "shell_command",
        args: { command: "git status --short || echo 'not a repo'" },
      },
    ],
  },
];

const customSkills = new Map<string, Skill>();

export function listSkills(): Skill[] {
  return [...builtinSkills, ...customSkills.values()];
}

export function getSkill(id: string): Skill | null {
  return builtinSkills.find((s) => s.id === id) || customSkills.get(id) || null;
}

export function registerSkill(skill: Omit<Skill, "id"> & { id?: string }): Skill {
  const s: Skill = {
    id: skill.id || randomUUID().slice(0, 10),
    name: skill.name,
    description: skill.description,
    steps: skill.steps || [],
    tags: skill.tags || [],
  };
  customSkills.set(s.id, s);
  log("info", `Skill registered: ${s.name}`, "skills");
  return s;
}

export async function runSkill(id: string): Promise<{ skill: Skill; results: any[] }> {
  const skill = getSkill(id);
  if (!skill) throw new Error("Skill not found: " + id);
  await runHooks("before_skill", { skillId: id });
  const results: any[] = [];
  for (const step of skill.steps) {
    if (step.note) {
      results.push({ note: step.note });
      continue;
    }
    if (step.tool) {
      const r = await dispatchTool(step.tool, step.args || {});
      results.push(r);
    }
  }
  await runHooks("after_skill", { skillId: id, results });
  return { skill, results };
}

// ── Plugins (extra tool definitions + handlers) ───────────────

export type PluginTool = {
  name: string;
  description: string;
  parameters?: Record<string, any>;
  handler: (args: Record<string, any>) => Promise<any> | any;
};

export type Plugin = {
  id: string;
  name: string;
  tools: PluginTool[];
};

const plugins = new Map<string, Plugin>();

export function listPlugins(): Plugin[] {
  return [...plugins.values()].map((p) => ({
    id: p.id,
    name: p.name,
    tools: p.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      handler: t.handler,
    })),
  }));
}

export function registerPlugin(plugin: Plugin): Plugin {
  plugins.set(plugin.id, plugin);
  log("info", `Plugin registered: ${plugin.name} (${plugin.tools.length} tools)`, "skills");
  return plugin;
}

export async function runPluginTool(name: string, args: Record<string, any> = {}): Promise<ToolResult> {
  const start = Date.now();
  for (const plugin of plugins.values()) {
    const tool = plugin.tools.find((t) => t.name === name);
    if (!tool) continue;
    try {
      await runHooks("before_tool", { tool: name, args });
      const result = await tool.handler(args);
      await runHooks("after_tool", { tool: name, result });
      return { toolName: name, args, result, executionTime: Date.now() - start };
    } catch (e: any) {
      return { toolName: name, args, error: e.message, executionTime: Date.now() - start };
    }
  }
  return { toolName: name, args, error: "Plugin tool not found: " + name, executionTime: Date.now() - start };
}

export function listPluginToolNames(): string[] {
  const names: string[] = [];
  for (const p of plugins.values()) for (const t of p.tools) names.push(t.name);
  return names;
}

// Built-in workspace utility plugin (real handlers)
registerPlugin({
  id: "workspace-utils",
  name: "Workspace Utils",
  tools: [
    {
      name: "echo_plugin",
      description: "Echo back a message via plugin",
      parameters: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
      handler: async (args) => ({ echo: args.message, via: "workspace-utils plugin" }),
    },
    {
      name: "queue_note",
      description: "Create a note task in the background queue",
      parameters: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      },
      handler: async (args) => createTask({ title: String(args.title), type: "agent_note" }),
    },
  ],
});

// ── Hooks ─────────────────────────────────────────────────────

export type HookEvent =
  | "before_tool"
  | "after_tool"
  | "before_skill"
  | "after_skill"
  | "on_message"
  | "on_patch";

type HookFn = (payload: any) => void | Promise<void>;

const hooks = new Map<HookEvent, HookFn[]>();

export function onHook(event: HookEvent, fn: HookFn) {
  const list = hooks.get(event) || [];
  list.push(fn);
  hooks.set(event, list);
  return () => {
    const next = (hooks.get(event) || []).filter((f) => f !== fn);
    hooks.set(event, next);
  };
}

export async function runHooks(event: HookEvent, payload: any) {
  const list = hooks.get(event) || [];
  for (const fn of list) {
    try {
      await fn(payload);
    } catch (e: any) {
      log("warn", `Hook ${event} error: ${e.message}`, "skills");
    }
  }
}

// default audit hook
onHook("after_tool", (payload) => {
  log("debug", `hook after_tool ${payload?.tool}`, "hooks");
});

// ── Workflows (named sequences) ───────────────────────────────

export type Workflow = {
  id: string;
  name: string;
  description: string;
  skillIds: string[];
};

const workflows = new Map<string, Workflow>();

export function registerWorkflow(wf: Workflow) {
  workflows.set(wf.id, wf);
  return wf;
}

export function listWorkflows(): Workflow[] {
  return [...workflows.values()];
}

export async function runWorkflow(id: string) {
  const wf = workflows.get(id);
  if (!wf) throw new Error("Workflow not found");
  const out = [];
  for (const sid of wf.skillIds) {
    out.push(await runSkill(sid));
  }
  return { workflow: wf, results: out };
}

registerWorkflow({
  id: "inspect-workspace",
  name: "Inspect workspace",
  description: "Run workspace report skill",
  skillIds: ["workspace-report"],
});

// ── MCP-like tool catalog (descriptor only) ───────────────────

export function mcpCatalog() {
  const core = TOOL_DEFINITIONS.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    source: "core",
  }));
  const plugin = listPluginToolNames().map((name) => {
    for (const p of plugins.values()) {
      const t = p.tools.find((x) => x.name === name);
      if (t) return { name, description: t.description, source: `plugin:${p.id}` };
    }
    return { name, description: "", source: "plugin" };
  });
  return { tools: [...core, ...plugin], skills: listSkills().map((s) => s.id), workflows: listWorkflows().map((w) => w.id) };
}
