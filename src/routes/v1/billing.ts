import { Router } from "express";
import { ok } from "../../lib/apiResponse.js";
import { requireAuth, type AuthRequest } from "../../lib/auth.js";
import {
  submitPayment,
  listPayments,
  billingInstructions,
} from "../../lib/billing.js";

const router = Router();

router.get("/instructions", (_req, res) => ok(res, billingInstructions()));

router.post("/submit", requireAuth, (req: AuthRequest, res, next) => {
  try {
    const pay = submitPayment({
      userId: req.userId!,
      email: req.user!.email,
      plan: String(req.body?.plan || ""),
      method: String(req.body?.method || ""),
      amount: String(req.body?.amount || ""),
      txnRef: String(req.body?.txnRef || ""),
      proofNote: req.body?.proofNote ? String(req.body.proofNote) : undefined,
    });
    return ok(res, { payment: pay }, 201);
  } catch (e) {
    next(e);
  }
});

router.get("/mine", requireAuth, (req: AuthRequest, res) => {
  return ok(res, { payments: listPayments({ userId: req.userId }) });
});

export default router;
