/**
 * Phase S4 — Plans catalog + current user plan
 */

import { Router } from "express";
import { ok, ApiError } from "../../lib/apiResponse.js";
import { requireAuth, type AuthRequest, setUserPlan, publicUser, findUserById } from "../../lib/auth.js";
import { plansPublic, getPlan, listPlans } from "../../lib/plans.js";

const router = Router();

/** Public pricing list */
router.get("/", (_req, res) => {
  return ok(res, { plans: plansPublic() });
});

/** Authenticated: my plan + limits */
router.get("/me", requireAuth, (req: AuthRequest, res) => {
  const plan = getPlan(req.user?.plan);
  return ok(res, {
    user: req.user,
    plan: {
      id: plan.id,
      name: plan.name,
      storageMb: plan.storageMb,
      maxProviders: plan.maxProviders,
      maxProjects: plan.maxProjects,
      messageQuotaDaily: plan.messageQuotaDaily,
      features: plan.features,
      priceLabel: plan.priceLabel,
    },
  });
});

/** Admin: assign plan to user */
router.post("/assign", requireAuth, (req: AuthRequest, res, next) => {
  try {
    if (req.user?.role !== "admin") {
      throw new ApiError(403, "forbidden", "Admin only");
    }
    const userId = String(req.body?.userId || "");
    const planId = String(req.body?.plan || "");
    if (!listPlans().some((p) => p.id === planId)) {
      throw new ApiError(400, "invalid_plan", "Unknown plan id");
    }
    const user = setUserPlan(userId, planId);
    return ok(res, { user: publicUser(user), plan: getPlan(planId) });
  } catch (e) {
    next(e);
  }
});

export default router;
