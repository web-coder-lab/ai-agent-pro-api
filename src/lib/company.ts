/**
 * Phase 32 — Company Roles + Mission Mode
 * Org agents (CEO→Support) and goal-oriented missions with state machine.
 */

import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { log } from "./logger.js";
import { createTask } from "./taskQueue.js";
import { addEntry } from "./workspaceMemory.js";

const DATA = join(process.cwd(), ".data");
const MISSIONS_FILE = join(DATA, "missions.json");
mkdirSync(DATA, { recursive: true });

// ── Roles ─────────────────────────────────────────────────────

export type CompanyRoleId =
  | "ceo"
  | "cto"
  | "pm"
  | "team_lead"
  | "owner"
  | "backend"
  | "frontend"
  | "security"
  | "devops"
  | "qa"
  | "docs"
  | "research"
  | "design"
  | "support";

export type CompanyRole = {
  id: CompanyRoleId;
  title: string;
  layer: "exec" | "lead" | "owner" | "employee";
  reportsTo?: CompanyRoleId;
  description: string;
  defaultTask: TaskKindHint;
};

type TaskKindHint = "plan" | "review" | "code" | "test" | "docs" | "ops" | "research";

export const COMPANY_ROLES: CompanyRole[] = [
  { id: "ceo", title: "CEO Agent", layer: "exec", description: "High-level goals from admin", defaultTask: "plan" },
  { id: "cto", title: "CTO Agent", layer: "exec", reportsTo: "ceo", description: "Technical strategy", defaultTask: "plan" },
  { id: "pm", title: "Project Manager", layer: "lead", reportsTo: "cto", description: "Scope & timeline", defaultTask: "plan" },
  { id: "team_lead", title: "Team Lead", layer: "lead", reportsTo: "pm", description: "Architecture & discussion (Head)", defaultTask: "plan" },
  { id: "owner", title: "Owner / Quality Gate", layer: "owner", reportsTo: "team_lead", description: "Assign, review, quality", defaultTask: "review" },
  { id: "backend", title: "Backend", layer: "employee", reportsTo: "owner", description: "APIs & services", defaultTask: "code" },
  { id: "frontend", title: "Frontend", layer: "employee", reportsTo: "owner", description: "UI", defaultTask: "code" },
  { id: "security", title: "Security", layer: "employee", reportsTo: "owner", description: "Hardening & review", defaultTask: "review" },
  { id: "devops", title: "DevOps", layer: "employee", reportsTo: "owner", description: "Deploy & infra", defaultTask: "ops" },
  { id: "qa", title: "QA", layer: "employee", reportsTo: "owner", description: "Tests", defaultTask: "test" },
  { id: "docs", title: "Documentation", layer: "employee", reportsTo: "owner", description: "Docs", defaultTask: "docs" },
  { id: "research", title: "Research", layer: "employee", reportsTo: "team_lead", description: "Research & compare", defaultTask: "research" },
  { id: "design", title: "Design", layer: "employee", reportsTo: "owner", description: "UX notes", defaultTask: "docs" },
  { id: "support", title: "Support", layer: "employee", reportsTo: "pm", description: "User reports triage", defaultTask: "review" },
];

export function listRoles() {
  return COMPANY_ROLES;
}

export function getRole(id: string) {
  return COMPANY_ROLES.find((r) => r.id === id) || null;
}

export function orgChart() {
  return COMPANY_ROLES.map((r) => ({
    id: r.id,
    title: r.title,
    layer: r.layer,
    reportsTo: r.reportsTo || null,
  }));
}

// ── Missions ──────────────────────────────────────────────────

export type MissionStatus =
  | "draft"
  | "discuss"
  | "planning"
  | "assigned"
  | "in_progress"
  | "owner_review"
  | "lead_review"
  | "admin_review"
  | "done"
  | "blocked"
  | "cancelled";

export type MissionEvent = {
  ts: string;
  from: string;
  action: string;
  note?: string;
};

export type Mission = {
  id: string;
  title: string;
  goal: string;
  status: MissionStatus;
  mode: "simple" | "team" | "company";
  createdAt: string;
  updatedAt: string;
  assigneeRoles: CompanyRoleId[];
  successCriteria: string[];
  events: MissionEvent[];
  taskIds: string[];
  blockedReason?: string;
};

type Store = { missions: Mission[] };

function load(): Store {
  if (!existsSync(MISSIONS_FILE)) return { missions: [] };
  try {
    return JSON.parse(readFileSync(MISSIONS_FILE, "utf8"));
  } catch {
    return { missions: [] };
  }
}

function save(s: Store) {
  writeFileSync(MISSIONS_FILE, JSON.stringify(s, null, 2));
}

function touch(m: Mission, from: string, action: string, note?: string) {
  m.updatedAt = new Date().toISOString();
  m.events.unshift({ ts: m.updatedAt, from, action, note });
  if (m.events.length > 100) m.events = m.events.slice(0, 100);
}

export function listMissions(status?: MissionStatus): Mission[] {
  let list = load().missions;
  if (status) list = list.filter((m) => m.status === status);
  return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getMission(id: string): Mission | null {
  return load().missions.find((m) => m.id === id) || null;
}

export function createMission(input: {
  title: string;
  goal: string;
  mode?: Mission["mode"];
  successCriteria?: string[];
  assigneeRoles?: CompanyRoleId[];
}): Mission {
  const m: Mission = {
    id: randomUUID().slice(0, 12),
    title: input.title,
    goal: input.goal,
    status: "draft",
    mode: input.mode || "team",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    assigneeRoles: input.assigneeRoles || ["team_lead", "owner", "backend", "qa"],
    successCriteria: input.successCriteria || ["Works", "Reviewed", "Admin approved"],
    events: [],
    taskIds: [],
  };
  touch(m, "system", "created", input.goal.slice(0, 120));
  const s = load();
  s.missions.unshift(m);
  save(s);
  addEntry("default", {
    section: "pending_tasks",
    title: `mission:${m.title}`,
    content: m.goal,
    tags: ["mission"],
  });
  log("info", `Mission created: ${m.title}`, "company");
  return m;
}

/** Advance mission along the company loop */
export function advanceMission(
  id: string,
  action:
    | "start_discuss"
    | "submit_plan"
    | "assign"
    | "start_work"
    | "submit_owner"
    | "owner_approve"
    | "owner_reject"
    | "lead_approve"
    | "lead_reject"
    | "admin_approve"
    | "admin_reject"
    | "block"
    | "cancel",
  opts?: { from?: string; note?: string }
): Mission {
  const s = load();
  const m = s.missions.find((x) => x.id === id);
  if (!m) throw new Error("Mission not found");

  const from = opts?.from || "system";
  const note = opts?.note;

  const transitions: Record<string, Partial<Record<MissionStatus, MissionStatus>>> = {
    start_discuss: { draft: "discuss", blocked: "discuss" },
    submit_plan: { discuss: "planning", draft: "planning" },
    assign: { planning: "assigned", owner_review: "assigned" },
    start_work: { assigned: "in_progress", owner_review: "in_progress" },
    submit_owner: { in_progress: "owner_review" },
    owner_approve: { owner_review: "lead_review" },
    owner_reject: { owner_review: "in_progress" },
    lead_approve: { lead_review: "admin_review" },
    lead_reject: { lead_review: "in_progress" },
    admin_approve: { admin_review: "done" },
    admin_reject: { admin_review: "in_progress" },
    block: {
      draft: "blocked",
      discuss: "blocked",
      planning: "blocked",
      assigned: "blocked",
      in_progress: "blocked",
      owner_review: "blocked",
      lead_review: "blocked",
      admin_review: "blocked",
    },
    cancel: {
      draft: "cancelled",
      discuss: "cancelled",
      planning: "cancelled",
      assigned: "cancelled",
      in_progress: "cancelled",
      blocked: "cancelled",
    },
  };

  const next = transitions[action]?.[m.status];
  if (!next) {
    throw new Error(`Cannot ${action} from status ${m.status}`);
  }

  m.status = next;
  if (action === "block") m.blockedReason = note || "blocked";
  if (action === "owner_reject" || action === "lead_reject" || action === "admin_reject") {
    // enqueue fix task
    const t = createTask({
      title: `Fix mission ${m.title}: ${note || "changes requested"}`,
      type: "agent_note",
      payload: { missionId: m.id, action },
    });
    m.taskIds.push(t.id);
  }

  if (action === "assign") {
    for (const role of m.assigneeRoles.filter((r) => getRole(r)?.layer === "employee")) {
      const t = createTask({
        title: `[${role}] ${m.title}`,
        type: "agent_note",
        payload: { missionId: m.id, role, goal: m.goal },
      });
      m.taskIds.push(t.id);
    }
  }

  if (action === "admin_approve") {
    addEntry("default", {
      section: "decisions",
      title: `mission-done:${m.title}`,
      content: m.goal,
      tags: ["mission", "done"],
    });
  }

  touch(m, from, action, note);
  save(s);
  log("info", `Mission ${m.id} → ${m.status} (${action})`, "company");
  return m;
}

/** Suggested next actions for UI */
export function nextActions(status: MissionStatus): string[] {
  const map: Record<MissionStatus, string[]> = {
    draft: ["start_discuss", "submit_plan", "cancel"],
    discuss: ["submit_plan", "block", "cancel"],
    planning: ["assign", "block", "cancel"],
    assigned: ["start_work", "block", "cancel"],
    in_progress: ["submit_owner", "block", "cancel"],
    owner_review: ["owner_approve", "owner_reject"],
    lead_review: ["lead_approve", "lead_reject"],
    admin_review: ["admin_approve", "admin_reject"],
    done: [],
    blocked: ["start_discuss", "cancel"],
    cancelled: [],
  };
  return map[status] || [];
}

export function missionStats() {
  const all = load().missions;
  const byStatus: Record<string, number> = {};
  for (const m of all) byStatus[m.status] = (byStatus[m.status] || 0) + 1;
  return { total: all.length, byStatus, roles: COMPANY_ROLES.length };
}
