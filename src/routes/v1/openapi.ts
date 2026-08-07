/**
 * Phase S10 — Lightweight OpenAPI-ish catalog (no extra deps)
 */

import { Router } from "express";
import { ok } from "../../lib/apiResponse.js";

const router = Router();

const spec = {
  openapi: "3.0.3",
  info: {
    title: "AI Agent Pro Public API",
    version: "v1",
    description: "Server block S1–S10 — Auth, plans, billing, workspace, admin",
  },
  servers: [{ url: "/api/v1" }],
  paths: {
    "/health": { get: { summary: "Health" } },
    "/ready": { get: { summary: "Ready" } },
    "/version": { get: { summary: "Version" } },
    "/auth/register": { post: { summary: "Register" } },
    "/auth/login": { post: { summary: "Login" } },
    "/auth/me": { get: { summary: "Current user", security: [{ bearer: [] }] } },
    "/auth/send-otp": { post: { summary: "Send OTP" } },
    "/auth/verify-otp": { post: { summary: "Verify OTP" } },
    "/auth/forgot": { post: { summary: "Forgot password" } },
    "/auth/reset": { post: { summary: "Reset password" } },
    "/plans": { get: { summary: "List plans" } },
    "/plans/me": { get: { summary: "My plan", security: [{ bearer: [] }] } },
    "/billing/instructions": { get: { summary: "Pay instructions" } },
    "/billing/submit": { post: { summary: "Submit payment", security: [{ bearer: [] }] } },
    "/billing/mine": { get: { summary: "My payments", security: [{ bearer: [] }] } },
    "/workspace/storage": { get: { summary: "Storage usage", security: [{ bearer: [] }] } },
    "/workspace/files": { get: { summary: "List files", security: [{ bearer: [] }] } },
    "/workspace/files/read": { get: { summary: "Read file", security: [{ bearer: [] }] } },
    "/workspace/files": { post: { summary: "Write file", security: [{ bearer: [] }] } },
    "/workspace/execute": { post: { summary: "Run code", security: [{ bearer: [] }] } },
    "/admin/overview": { get: { summary: "Admin overview", security: [{ bearer: [] }] } },
    "/admin/users": { get: { summary: "List users", security: [{ bearer: [] }] } },
    "/admin/payments": { get: { summary: "List payments", security: [{ bearer: [] }] } },
    "/admin/payments/{id}/approve": { post: { summary: "Approve payment", security: [{ bearer: [] }] } },
    "/admin/payments/{id}/reject": { post: { summary: "Reject payment", security: [{ bearer: [] }] } },
  },
  components: {
    securitySchemes: {
      bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
  },
};

router.get("/openapi.json", (_req, res) => ok(res, spec));
router.get("/docs", (_req, res) => {
  return ok(res, {
    message: "OpenAPI JSON at GET /api/v1/openapi.json",
    endpoints: Object.keys(spec.paths),
  });
});

export default router;
