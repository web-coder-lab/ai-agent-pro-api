/**
 * Phase S5 — Billing: manual payments (JazzCash / Easypaisa / bank)
 */

import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ApiError } from "./apiResponse.js";
import { getPlan, type PlanId, listPlans } from "./plans.js";
import { setUserPlan, findUserById, publicUser } from "./auth.js";
import { sendTemplate } from "./mailer.js";
import { log } from "./logger.js";

const DATA = join(process.cwd(), ".data");
const FILE = join(DATA, "payments.json");
mkdirSync(DATA, { recursive: true });

export type PayMethod = "jazzcash" | "easypaisa" | "bank" | "other";
export type PayStatus = "pending" | "approved" | "rejected";

export type Payment = {
  id: string;
  userId: string;
  email: string;
  plan: PlanId;
  method: PayMethod;
  amount: string;
  txnRef: string;
  proofNote?: string;
  status: PayStatus;
  createdAt: string;
  updatedAt: string;
  reviewedBy?: string;
};

type Store = { payments: Payment[] };

function load(): Store {
  if (!existsSync(FILE)) return { payments: [] };
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Store;
  } catch {
    return { payments: [] };
  }
}
function save(s: Store) {
  writeFileSync(FILE, JSON.stringify(s, null, 2));
}

export function submitPayment(input: {
  userId: string;
  email: string;
  plan: string;
  method: string;
  amount: string;
  txnRef: string;
  proofNote?: string;
}): Payment {
  if (!listPlans().some((p) => p.id === input.plan)) {
    throw new ApiError(400, "invalid_plan", "Unknown plan");
  }
  if (input.plan === "free") {
    throw new ApiError(400, "invalid_plan", "Cannot submit payment for free plan");
  }
  const method = input.method as PayMethod;
  if (!["jazzcash", "easypaisa", "bank", "other"].includes(method)) {
    throw new ApiError(400, "invalid_method", "method must be jazzcash|easypaisa|bank|other");
  }
  if (!input.txnRef || String(input.txnRef).trim().length < 3) {
    throw new ApiError(400, "invalid_txn", "Transaction reference required");
  }
  const s = load();
  const now = new Date().toISOString();
  const row: Payment = {
    id: randomBytes(8).toString("hex"),
    userId: input.userId,
    email: input.email,
    plan: input.plan as PlanId,
    method,
    amount: String(input.amount || getPlan(input.plan).priceLabel),
    txnRef: String(input.txnRef).trim(),
    proofNote: input.proofNote,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  s.payments.unshift(row);
  save(s);
  log("info", `Payment submitted ${row.id} ${row.plan} by ${row.email}`, "billing");
  return row;
}

export function listPayments(filter?: { userId?: string; status?: PayStatus }) {
  let rows = load().payments;
  if (filter?.userId) rows = rows.filter((p) => p.userId === filter.userId);
  if (filter?.status) rows = rows.filter((p) => p.status === filter.status);
  return rows;
}

export function getPayment(id: string) {
  return load().payments.find((p) => p.id === id) || null;
}

export async function reviewPayment(
  id: string,
  action: "approved" | "rejected",
  adminId: string
) {
  const s = load();
  const idx = s.payments.findIndex((p) => p.id === id);
  if (idx < 0) throw new ApiError(404, "not_found", "Payment not found");
  const pay = s.payments[idx];
  if (pay.status !== "pending") {
    throw new ApiError(400, "already_reviewed", "Payment already reviewed");
  }
  pay.status = action;
  pay.reviewedBy = adminId;
  pay.updatedAt = new Date().toISOString();
  s.payments[idx] = pay;
  save(s);

  if (action === "approved") {
    await setUserPlan(pay.userId, pay.plan);
    const user = await findUserById(pay.userId);
    try {
      await sendTemplate(pay.email, "payment-confirm", {
        name: user?.name || "",
        plan: pay.plan,
        amount: pay.amount,
        ref: pay.txnRef,
      });
    } catch (e: any) {
      log("warn", `Payment email fail: ${e.message}`, "billing");
    }
  }
  log("info", `Payment ${id} ${action} by admin ${adminId}`, "billing");
  return pay;
}

export function billingInstructions() {
  return {
    methods: [
      {
        id: "jazzcash",
        name: "JazzCash",
        steps: [
          "Send amount to the JazzCash number shown on pricing/billing page (set in env BILLING_JAZZCASH).",
          "Copy transaction ID.",
          "Submit payment form with plan + txn ref.",
          "Wait for admin approval — plan activates + email.",
        ],
      },
      {
        id: "easypaisa",
        name: "Easypaisa",
        steps: [
          "Send amount to Easypaisa number (env BILLING_EASYPAISA).",
          "Submit txn ref on billing form.",
        ],
      },
      {
        id: "bank",
        name: "Bank transfer",
        steps: ["Transfer to account in env BILLING_BANK_INFO", "Submit reference."],
      },
    ],
    comingSoon: ["google_pay", "paypal"],
    contacts: {
      jazzcash: process.env.BILLING_JAZZCASH || null,
      easypaisa: process.env.BILLING_EASYPAISA || null,
      bank: process.env.BILLING_BANK_INFO || null,
    },
  };
}
