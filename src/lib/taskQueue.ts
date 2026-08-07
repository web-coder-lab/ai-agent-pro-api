/**
 * Phase 20 — Task Planner + Background Worker Queue
 */

import { log } from "./logger.js";
import { randomUUID } from "crypto";
import { runCode } from "./codeRunner.js";
import { writeWorkspaceFile, readWorkspaceFile } from "./fileManager.js";

export type TaskStatus = "pending" | "running" | "done" | "failed" | "cancelled";
export type TaskType = "shell" | "code" | "write_file" | "agent_note" | "subagent";

export type Task = {
  id: string;
  title: string;
  type: TaskType;
  payload: Record<string, any>;
  status: TaskStatus;
  result?: any;
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  parentId?: string;
};

const tasks = new Map<string, Task>();
let processing = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function listTasks(filter?: { status?: TaskStatus; parentId?: string }): Task[] {
  let all = [...tasks.values()].sort((a, b) =>
    (b.createdAt || "").localeCompare(a.createdAt || "")
  );
  if (filter?.status) all = all.filter((t) => t.status === filter.status);
  if (filter?.parentId !== undefined) all = all.filter((t) => t.parentId === filter.parentId);
  return all;
}

export function getTask(id: string): Task | null {
  return tasks.get(id) || null;
}

export function createTask(input: {
  title: string;
  type?: TaskType;
  payload?: Record<string, any>;
  parentId?: string;
}): Task {
  const task: Task = {
    id: randomUUID().slice(0, 12),
    title: input.title,
    type: input.type || "agent_note",
    payload: input.payload || {},
    status: "pending",
    createdAt: new Date().toISOString(),
    parentId: input.parentId,
  };
  tasks.set(task.id, task);
  log("info", `Task created: ${task.title}`, "queue");
  ensureWorker();
  return task;
}

export function createPlanTasks(steps: string[], parentTitle = "Plan"): Task[] {
  const parent = createTask({
    title: parentTitle,
    type: "agent_note",
    payload: { role: "plan_parent", steps },
  });
  // mark parent as done container
  parent.status = "done";
  parent.finishedAt = new Date().toISOString();
  tasks.set(parent.id, parent);

  return steps.map((step, i) =>
    createTask({
      title: `${i + 1}. ${step}`,
      type: "agent_note",
      payload: { stepIndex: i, text: step },
      parentId: parent.id,
    })
  );
}

export function cancelTask(id: string): Task | null {
  const t = tasks.get(id);
  if (!t) return null;
  if (t.status === "pending") {
    t.status = "cancelled";
    t.finishedAt = new Date().toISOString();
    tasks.set(id, t);
  }
  return t;
}

export function clearDone(): number {
  let n = 0;
  for (const [id, t] of tasks) {
    if (t.status === "done" || t.status === "cancelled" || t.status === "failed") {
      tasks.delete(id);
      n++;
    }
  }
  return n;
}

async function runTask(task: Task): Promise<void> {
  task.status = "running";
  task.startedAt = new Date().toISOString();
  tasks.set(task.id, task);
  log("info", `Task running: ${task.title}`, "queue");

  try {
    let result: any;
    switch (task.type) {
      case "shell": {
        const cmd = String(task.payload.command || "echo empty");
        result = await runCode("bash", cmd);
        if (result.exitCode !== 0) throw new Error(result.stderr || "shell failed");
        break;
      }
      case "code": {
        result = await runCode(
          String(task.payload.language || "python"),
          String(task.payload.code || "print(1)")
        );
        if (result.exitCode !== 0) throw new Error(result.stderr || "code failed");
        break;
      }
      case "write_file": {
        result = await writeWorkspaceFile(
          String(task.payload.path),
          String(task.payload.content ?? "")
        );
        break;
      }
      case "subagent": {
        // Lightweight subagent: run code or shell from payload; full LLM subagent needs API key context
        if (task.payload.command) {
          result = await runCode("bash", String(task.payload.command));
        } else if (task.payload.code) {
          result = await runCode(
            String(task.payload.language || "python"),
            String(task.payload.code)
          );
        } else {
          throw new Error("subagent task requires payload.command or payload.code");
        }
        break;
      }
      case "agent_note":
      default:
        result = { noted: true, text: task.payload.text || task.title };
        break;
    }
    task.result = result;
    task.status = "done";
    task.finishedAt = new Date().toISOString();
    tasks.set(task.id, task);
    log("info", `Task done: ${task.title}`, "queue");
  } catch (e: any) {
    task.error = e.message || String(e);
    task.status = "failed";
    task.finishedAt = new Date().toISOString();
    tasks.set(task.id, task);
    log("error", `Task failed: ${task.title} — ${task.error}`, "queue");
  }
}

async function tick() {
  if (processing) return;
  const next = [...tasks.values()].find((t) => t.status === "pending");
  if (!next) return;
  processing = true;
  try {
    await runTask(next);
  } finally {
    processing = false;
  }
}

export function ensureWorker() {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch(() => {});
  }, 500);
  log("info", "Task worker started", "queue");
}

export function stopWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function queueStats() {
  const all = [...tasks.values()];
  return {
    total: all.length,
    pending: all.filter((t) => t.status === "pending").length,
    running: all.filter((t) => t.status === "running").length,
    done: all.filter((t) => t.status === "done").length,
    failed: all.filter((t) => t.status === "failed").length,
    cancelled: all.filter((t) => t.status === "cancelled").length,
    worker: !!timer,
  };
}
