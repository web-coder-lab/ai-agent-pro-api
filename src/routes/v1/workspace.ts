/**
 * Phase S6/S7 — User workspace files + storage + execute (isolated)
 */

import { Router } from "express";
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, rmSync, statSync } from "fs";
import { dirname, join } from "path";
import { ok, ApiError } from "../../lib/apiResponse.js";
import { requireAuth, type AuthRequest } from "../../lib/auth.js";
import {
  safeUserPath,
  listUserFiles,
  userWorkspaceRoot,
} from "../../lib/userWorkspace.js";
import { storageStatus, assertStorageAllowed } from "../../lib/storageQuota.js";
import { runCode } from "../../lib/codeRunner.js";

const router = Router();
router.use(requireAuth);

router.get("/storage", async (req: AuthRequest, res, next) => {
  try {
  return ok(res, await storageStatus(req.userId!));
  } catch(e) { next(e); }
});

router.get("/files", (req: AuthRequest, res, next) => {
  try {
    const path = String(req.query.path || ".");
    return ok(res, { files: listUserFiles(req.userId!, path), root: `users/${req.userId}` });
  } catch (e) {
    next(e);
  }
});

router.get("/files/read", (req: AuthRequest, res, next) => {
  try {
    const path = String(req.query.path || "");
    if (!path) throw new ApiError(400, "bad_request", "path required");
    const abs = safeUserPath(req.userId!, path);
    if (!existsSync(abs)) throw new ApiError(404, "not_found", "File not found");
    const content = readFileSync(abs, "utf8");
    return ok(res, { path, content, size: Buffer.byteLength(content) });
  } catch (e) {
    next(e);
  }
});

router.post("/files", async (req: AuthRequest, res, next) => {
  try {
    const path = String(req.body?.path || "");
    const content = String(req.body?.content ?? "");
    if (!path) throw new ApiError(400, "bad_request", "path required");
    await assertStorageAllowed(req.userId!, Buffer.byteLength(content));
    const abs = safeUserPath(req.userId!, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
    return ok(res, { path, size: Buffer.byteLength(content) }, 201);
  } catch (e) {
    next(e);
  }
});

router.delete("/files", (req: AuthRequest, res, next) => {
  try {
    const path = String(req.body?.path || req.query.path || "");
    if (!path) throw new ApiError(400, "bad_request", "path required");
    const abs = safeUserPath(req.userId!, path);
    if (!existsSync(abs)) throw new ApiError(404, "not_found", "Not found");
    const st = statSync(abs);
    if (st.isDirectory()) rmSync(abs, { recursive: true, force: true });
    else unlinkSync(abs);
    return ok(res, { deleted: path });
  } catch (e) {
    next(e);
  }
});

router.post("/mkdir", (req: AuthRequest, res, next) => {
  try {
    const path = String(req.body?.path || "");
    if (!path) throw new ApiError(400, "bad_request", "path required");
    const abs = safeUserPath(req.userId!, path);
    mkdirSync(abs, { recursive: true });
    return ok(res, { path });
  } catch (e) {
    next(e);
  }
});

router.post("/execute", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const language = String(req.body?.language || "python");
    const code = String(req.body?.code || "");
    if (!code) throw new ApiError(400, "bad_request", "code required");
    // run in user workspace cwd
    const cwd = userWorkspaceRoot(req.userId!);
    const result = await runCode(language, code);
    return ok(res, { ...result, cwd: `workspace/users/${req.userId}` });
  } catch (e) {
    next(e);
  }
});

export default router;
