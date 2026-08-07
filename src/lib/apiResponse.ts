/**
 * Phase S1 — Standard API response + error shape for /api/v1
 */

import type { Request, Response, NextFunction } from "express";

export type ApiErrorBody = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
  version: "v1";
};

export type ApiSuccessBody<T = unknown> = {
  ok: true;
  data: T;
  version: "v1";
};

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function ok<T>(res: Response, data: T, status = 200) {
  const body: ApiSuccessBody<T> = { ok: true, data, version: "v1" };
  return res.status(status).json(body);
}

export function fail(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
) {
  const body: ApiErrorBody = {
    ok: false,
    error: { code, message, details },
    version: "v1",
  };
  return res.status(status).json(body);
}

/** Express error middleware for /api/v1 */
export function v1ErrorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (res.headersSent) return;

  if (err instanceof ApiError) {
    return fail(res, err.status, err.code, err.message, err.details);
  }

  const status = Number(err?.status || err?.statusCode) || 500;
  const message = err?.message || "Internal server error";
  const code =
    status === 400
      ? "bad_request"
      : status === 401
        ? "unauthorized"
        : status === 403
          ? "forbidden"
          : status === 404
            ? "not_found"
            : status === 429
              ? "rate_limited"
              : "internal_error";

  return fail(res, status, code, message);
}

export function notFoundV1(req: Request, res: Response) {
  return fail(res, 404, "not_found", `Route not found: ${req.method} ${req.path}`);
}
