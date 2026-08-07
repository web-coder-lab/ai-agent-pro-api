/**
 * Admin API — AD1–AD5
 * Users/Payments via Firebase when available
 */

import { Router } from "express";
import { ok, ApiError } from "../../lib/apiResponse.js";
import {
  requireAuth,
  type AuthRequest,
  publicUser,
  setUserPlan,
  setUserBanned,
  authStats,
  listUsers,
} from "../../lib/auth.js";
import { listPayments, reviewPayment } from "../../lib/billing.js";
import { listPlans, getPlan, plansPublic } from "../../lib/plans.js";
import { mailStatus } from "../../lib/mailer.js";
import {
  listAnnouncements,
  createAnnouncement,
  setAnnouncementActive,
} from "../../lib/announcements.js";
import { getLogs } from "../../lib/logger.js";
import { firebaseStatus } from "../../lib/firebase.js";

const router = Router();

function adminOnly(req: AuthRequest, _res: any, next: any) {
  requireAuth(req, _res, (err?: any) => {
    if (err) return next(err);
    if (req.user?.role !== "admin") {
      return next(new ApiError(403, "forbidden", "Admin only"));
    }
    next();
  });
}

router.use(adminOnly);

router.get("/overview", async (_req, res, next) => {
  try {
    const users = await listUsers();
    return ok(res, {
      auth: await authStats(),
      mail: mailStatus(),
      firebase: firebaseStatus(),
      paymentsPending: listPayments({ status: "pending" }).length,
      paymentsTotal: listPayments().length,
      plans: listPlans().map((p) => p.id),
      users: users.length,
      announcements: listAnnouncements().length,
    });
  } catch (e) {
    next(e);
  }
});

router.get("/users", async (_req, res, next) => {
  try {
    return ok(res, { users: await listUsers() });
  } catch (e) {
    next(e);
  }
});

router.post("/users/:id/plan", async (req: AuthRequest, res, next) => {
  try {
    const plan = String(req.body?.plan || "");
    if (!listPlans().some((p) => p.id === plan)) {
      throw new ApiError(400, "invalid_plan", "Unknown plan");
    }
    const user = await setUserPlan(req.params.id, plan);
    return ok(res, { user: publicUser(user), plan: getPlan(plan) });
  } catch (e) {
    next(e);
  }
});

router.post("/users/:id/ban", async (req: AuthRequest, res, next) => {
  try {
    const banned = req.body?.banned !== false && req.body?.banned !== "false";
    const user = await setUserBanned(req.params.id, !!banned);
    return ok(res, { user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

router.get("/payments", (req, res) => {
  const status = req.query.status as any;
  return ok(res, {
    payments: listPayments(status ? { status } : undefined),
  });
});

router.post("/payments/:id/approve", async (req: AuthRequest, res, next) => {
  try {
    const pay = await reviewPayment(req.params.id, "approved", req.userId!);
    return ok(res, { payment: pay, plan: getPlan(pay.plan) });
  } catch (e) {
    next(e);
  }
});

router.post("/payments/:id/reject", async (req: AuthRequest, res, next) => {
  try {
    const pay = await reviewPayment(req.params.id, "rejected", req.userId!);
    return ok(res, { payment: pay });
  } catch (e) {
    next(e);
  }
});

router.get("/plans", (_req, res) => {
  return ok(res, { plans: plansPublic() });
});

router.get("/announcements", (_req, res) => {
  return ok(res, { items: listAnnouncements() });
});

router.post("/announcements", (req, res, next) => {
  try {
    const row = createAnnouncement(
      String(req.body?.title || ""),
      String(req.body?.body || "")
    );
    return ok(res, { item: row }, 201);
  } catch (e) {
    next(e);
  }
});

router.post("/announcements/:id/active", (req, res, next) => {
  try {
    const active = req.body?.active !== false && req.body?.active !== "false";
    const row = setAnnouncementActive(req.params.id, !!active);
    return ok(res, { item: row });
  } catch (e) {
    next(e);
  }
});

router.get("/logs", (req, res) => {
  const limit = Number(req.query.limit || 80);
  const filter = req.query.filter ? String(req.query.filter) : undefined;
  return ok(res, { logs: getLogs({ limit, filter }) });
});

router.get("/health", (_req, res) => {
  return ok(res, {
    uptimeSec: Math.floor(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    node: process.version,
    mail: mailStatus(),
    firebase: firebaseStatus(),
    time: new Date().toISOString(),
  });
});

export default router;
