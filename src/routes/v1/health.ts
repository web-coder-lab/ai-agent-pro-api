/**
 * Phase S1 — Health / ready / version under /api/v1
 */

import { Router } from "express";
import { ok } from "../../lib/apiResponse.js";
import { readFileSync } from "fs";
import { join } from "path";
import { firebaseStatus } from "../../lib/firebase.js";

const router = Router();

function pkgVersion(): string {
  try {
    const p = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8")
    );
    return p.version || "2.52.0-firebase";
  } catch {
    return "2.52.0-firebase";
  }
}

router.get("/health", (_req, res) => {
  const fb = firebaseStatus();
  return ok(res, {
    status: "ok",
    service: "ai-agent-pro-api",
    version: pkgVersion(),
    time: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
    firebase: fb,
    smtpConfigured: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
  });
});

router.get("/ready", (_req, res) => {
  const fb = firebaseStatus();
  return ok(res, {
    ready: true,
    firebase: fb.ok,
    smtp: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
    time: new Date().toISOString(),
  });
});

router.get("/version", (_req, res) => {
  return ok(res, {
    name: "ai-agent-pro",
    version: pkgVersion(),
    api: "v1",
    node: process.version,
    phases: "1-48+S1+Firebase",
    firebaseProject: process.env.FIREBASE_PROJECT_ID || "rg-tournament-ccd7d",
  });
});

export default router;
