/**
 * Phase S4 — Subscription plans, limits, feature flags
 */

import { ApiError } from "./apiResponse.js";
import type { AuthRequest } from "./auth.js";
import { findUserById } from "./auth.js";
import type { Response, NextFunction } from "express";

export type PlanId = "free" | "weekly" | "monthly" | "six_month" | "yearly";

export type FeatureFlag =
  | "chat"
  | "build"
  | "plan_mode"
  | "database"
  | "multi_providers"
  | "github_export"
  | "zip_export"
  | "cloudflare_tunnel"
  | "ai_team"
  | "priority_queue"
  | "backups"
  | "personal_ai"
  | "vps"
  | "ai_devops"
  | "ads_required";

export type PlanDef = {
  id: PlanId;
  name: string;
  storageMb: number;
  maxProviders: number;
  maxProjects: number;
  messageQuotaDaily: number | null; // null = unlimited
  features: FeatureFlag[];
  priceLabel: string;
  durationDays: number | null; // null = no expiry for free
};

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: "free",
    name: "Free",
    storageMb: 100,
    maxProviders: 1,
    maxProjects: 3,
    messageQuotaDaily: 20,
    features: ["chat", "ads_required"],
    priceLabel: "Rs 0",
    durationDays: null,
  },
  weekly: {
    id: "weekly",
    name: "Weekly",
    storageMb: 500,
    maxProviders: 1,
    maxProjects: 10,
    messageQuotaDaily: 200,
    features: ["chat", "build", "plan_mode", "database"],
    priceLabel: "Starter",
    durationDays: 7,
  },
  monthly: {
    id: "monthly",
    name: "Monthly",
    storageMb: 1024,
    maxProviders: 5,
    maxProjects: 50,
    messageQuotaDaily: null,
    features: [
      "chat",
      "build",
      "plan_mode",
      "database",
      "multi_providers",
      "github_export",
      "zip_export",
      "cloudflare_tunnel",
      "ai_team",
    ],
    priceLabel: "Power",
    durationDays: 30,
  },
  six_month: {
    id: "six_month",
    name: "6 Months",
    storageMb: 2048,
    maxProviders: 10,
    maxProjects: 100,
    messageQuotaDaily: null,
    features: [
      "chat",
      "build",
      "plan_mode",
      "database",
      "multi_providers",
      "github_export",
      "zip_export",
      "cloudflare_tunnel",
      "ai_team",
      "priority_queue",
      "backups",
    ],
    priceLabel: "Growth",
    durationDays: 183,
  },
  yearly: {
    id: "yearly",
    name: "Yearly",
    storageMb: 4096,
    maxProviders: 20,
    maxProjects: 500,
    messageQuotaDaily: null,
    features: [
      "chat",
      "build",
      "plan_mode",
      "database",
      "multi_providers",
      "github_export",
      "zip_export",
      "cloudflare_tunnel",
      "ai_team",
      "priority_queue",
      "backups",
      "personal_ai",
      "vps",
      "ai_devops",
    ],
    priceLabel: "Ultimate",
    durationDays: 365,
  },
};

export function listPlans(): PlanDef[] {
  return Object.values(PLANS);
}

export function getPlan(id?: string | null): PlanDef {
  const key = (id || "free") as PlanId;
  return PLANS[key] || PLANS.free;
}

export function planHasFeature(planId: string | null | undefined, feature: FeatureFlag) {
  const plan = getPlan(planId);
  return plan.features.includes(feature);
}

export async function getUserPlan(userId: string): Promise<PlanDef> {
  const user = await findUserById(userId);
  return getPlan(user?.plan || "free");
}

/** Middleware: require authenticated user + feature on their plan */
export function requireFeature(feature: FeatureFlag) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    const planId = req.user?.plan || "free";
    if (!planHasFeature(planId, feature)) {
      return next(
        new ApiError(
          403,
          "plan_required",
          `Feature "${feature}" requires a higher plan`,
          { feature, currentPlan: planId }
        )
      );
    }
    next();
  };
}

/** Middleware: require minimum plan tier (order: free < weekly < monthly < six_month < yearly) */
const ORDER: PlanId[] = ["free", "weekly", "monthly", "six_month", "yearly"];

export function requireMinPlan(min: PlanId) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    const current = (req.user?.plan || "free") as PlanId;
    if (ORDER.indexOf(current) < ORDER.indexOf(min)) {
      return next(
        new ApiError(403, "plan_required", `Requires ${min} plan or higher`, {
          currentPlan: current,
          required: min,
        })
      );
    }
    next();
  };
}

export function plansPublic() {
  return listPlans().map((p) => ({
    id: p.id,
    name: p.name,
    storageMb: p.storageMb,
    maxProviders: p.maxProviders,
    maxProjects: p.maxProjects,
    messageQuotaDaily: p.messageQuotaDaily,
    features: p.features,
    priceLabel: p.priceLabel,
    durationDays: p.durationDays,
  }));
}
