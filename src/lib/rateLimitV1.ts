/**
 * Phase S8 — Simple in-memory rate limit for /api/v1
 */

import type { Request, Response, NextFunction } from "express";
import { fail } from "./apiResponse.js";

const hits = new Map<string, { n: number; reset: number }>();
const WINDOW_MS = 60_000;
const MAX = Number(process.env.API_RATE_LIMIT || 120);

export function rateLimitV1(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || req.headers["x-forwarded-for"]?.toString() || "unknown";
  const now = Date.now();
  let row = hits.get(key);
  if (!row || row.reset < now) {
    row = { n: 0, reset: now + WINDOW_MS };
    hits.set(key, row);
  }
  row.n += 1;
  if (row.n > MAX) {
    return fail(res, 429, "rate_limited", "Too many requests", {
      retryAfterSec: Math.ceil((row.reset - now) / 1000),
    });
  }
  next();
}
