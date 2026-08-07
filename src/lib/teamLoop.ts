/**
 * Phase 33 — Team loops × Agent integration
 * Role-based prompts + mission-aware agent runs + tools to advance missions.
 */

import {
  getRole, getMission, advanceMission, nextActions, listMissions,
  type CompanyRoleId, type Mission,
} from "./company.js";
import { runAgentLoop, type AgentMode, type AgentEvent } from "./agent.js";
import { log } from "./logger.js";
import { addEntry } from "./workspaceMemory.js";

export type RoleRunOpts = {
  roleId: CompanyRoleId;
  missionId?: string;
  message: string;
  convId: number;
  model?: string;
  providerId?: number;
  onEvent?: (ev: AgentEvent) => void;
};

function roleSystemAddon(roleId: CompanyRoleId, mission?: Mission | null): string {
  const role = getRole(roleId);
  if (!role) return "";

  const lines = [
    `You are acting as **${role.title}** (${role.layer}).`,
    role.description,
    `Focus: ${role.defaultTask}.`,
  ];

  if (role.layer === "lead" || role.id === "team_lead") {
    lines.push("Discuss architecture, produce clear plans. Do not implement large code dumps unless asked.");
  }
  if (role.id === "owner") {
    lines.push("Break work into employee tasks, review quality, request fixes. Gate before lead review.");
  }
  if (role.layer === "employee") {
    lines.push("Implement assigned work with tools. Report concrete results (files, commands, tests).");
  }
  if (role.layer === "exec") {
    lines.push("Stay high-level: goals, priorities, tradeoffs. Defer implementation to the team.");
  }

  if (mission) {
    lines.push(
      "",
      `--- ACTIVE MISSION ---`,
      `ID: ${mission.id}`,
      `Title: ${mission.title}`,
      `Status: ${mission.status}`,
      `Goal: ${mission.goal}`,
      `Success: ${mission.successCriteria.join("; ")}`,
      `Next legal actions: ${nextActions(mission.status).join(", ") || "none"}`,
      "When your part is done, say which mission action should be taken next."
    );
  }

  return lines.join("\n");
}

/** Prefix user message with role+mission context for existing agent loop */
export function buildRoleUserMessage(roleId: CompanyRoleId, message: string, missionId?: string) {
  const mission = missionId ? getMission(missionId) : null;
  const addon = roleSystemAddon(roleId, mission);
  return `[ROLE CONTEXT]\n${addon}\n\n[USER / TASK]\n${message}`;
}

export async function runAsRole(opts: RoleRunOpts) {
  const mode: AgentMode =
    opts.roleId === "team_lead" || opts.roleId === "ceo" || opts.roleId === "cto" || opts.roleId === "pm"
      ? "plan"
      : opts.roleId === "owner" || opts.roleId === "qa" || opts.roleId === "security"
        ? "ask"
        : "build";

  // Owner/QA use build for real tool use when reviewing with fixes — prefer build for employees
  const effectiveMode: AgentMode =
    getRole(opts.roleId)?.layer === "employee" ? "build" : mode === "ask" ? "build" : mode;

  const content = buildRoleUserMessage(opts.roleId, opts.message, opts.missionId);

  log("info", `Role run ${opts.roleId} mission=${opts.missionId || "-"} mode=${effectiveMode}`, "team");

  const result = await runAgentLoop(opts.convId, content, {
    model: opts.model,
    providerId: opts.providerId,
    mode: effectiveMode,
    onEvent: opts.onEvent,
  });

  return {
    roleId: opts.roleId,
    missionId: opts.missionId,
    mode: effectiveMode,
    ...result,
  };
}

/** Suggest auto-advance after a role finishes (heuristic, not forced) */
export function suggestAdvance(roleId: CompanyRoleId, missionId: string): string | null {
  const m = getMission(missionId);
  if (!m) return null;
  const next = nextActions(m.status);
  if (roleId === "team_lead" && next.includes("submit_plan")) return "submit_plan";
  if (roleId === "owner" && next.includes("assign")) return "assign";
  if (roleId === "owner" && next.includes("owner_approve")) return "owner_approve";
  if (getRole(roleId)?.layer === "employee" && next.includes("submit_owner")) return "submit_owner";
  if (roleId === "team_lead" && next.includes("lead_approve")) return "lead_approve";
  return null;
}

export function teamHandOff(missionId: string, action: string, from: string, note?: string) {
  const m = advanceMission(missionId, action as any, { from, note });
  addEntry("default", {
    section: "decisions",
    title: `handoff:${m.status}`,
    content: `${from} → ${action} on mission ${m.title}${note ? ": " + note : ""}`,
    tags: ["mission", "handoff"],
  });
  return { ...m, next: nextActions(m.status) };
}

export function activeMissionsForRole(roleId: CompanyRoleId) {
  return listMissions().filter(
    (m) =>
      !["done", "cancelled"].includes(m.status) &&
      (m.assigneeRoles.includes(roleId) || roleId === "ceo" || roleId === "team_lead" || roleId === "owner")
  );
}
