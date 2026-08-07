/**
 * Phase S2–S3 — Auth + OTP + forgot/reset + mail
 * Users stored in Firebase Firestore
 */

import { Router } from "express";
import {
  registerUser,
  loginUser,
  publicUser,
  signToken,
  requireAuth,
  authStats,
  findUserByEmail,
  markEmailVerified,
  updatePassword,
  type AuthRequest,
} from "../../lib/auth.js";
import { ok, ApiError } from "../../lib/apiResponse.js";
import { log } from "../../lib/logger.js";
import { sendTemplate, mailStatus } from "../../lib/mailer.js";
import {
  createRegisterOtp,
  verifyRegisterOtp,
  createResetToken,
  consumeResetToken,
} from "../../lib/otp.js";

const router = Router();

router.post("/register", async (req, res, next) => {
  try {
    const { email, password, name } = req.body || {};
    const user = await registerUser({ email, password, name });
    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    let mail: unknown = null;
    try {
      const otp = createRegisterOtp(user.email, 10);
      mail = await sendTemplate(user.email, "register-otp", {
        name: user.name,
        code: otp.code,
        expiresMinutes: String(otp.expiresMinutes),
      });
      await sendTemplate(user.email, "welcome", { name: user.name });
    } catch (e: any) {
      log("warn", `Register mail skip: ${e.message}`, "auth");
    }

    log("info", `User registered ${user.email}`, "auth");
    return ok(
      res,
      {
        user: publicUser(user),
        token,
        tokenType: "Bearer",
        mail,
      },
      201
    );
  } catch (e) {
    next(e);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      throw new ApiError(400, "bad_request", "email and password required");
    }
    const user = await loginUser(String(email), String(password));
    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    log("info", `User login ${user.email}`, "auth");
    return ok(res, {
      user: publicUser(user),
      token,
      tokenType: "Bearer",
    });
  } catch (e) {
    next(e);
  }
});

router.get("/me", requireAuth, (req: AuthRequest, res) => {
  return ok(res, { user: req.user });
});

router.get("/stats", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (req.user?.role !== "admin") {
      throw new ApiError(403, "forbidden", "Admin only");
    }
    return ok(res, { ...(await authStats()), mail: mailStatus() });
  } catch (e) {
    next(e);
  }
});

router.post("/send-otp", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").toLowerCase();
    const user = await findUserByEmail(email);
    if (!user) throw new ApiError(404, "not_found", "User not found");
    if (user.emailVerified) {
      return ok(res, { alreadyVerified: true });
    }
    const otp = createRegisterOtp(user.email, 10);
    const mail = await sendTemplate(user.email, "register-otp", {
      name: user.name,
      code: otp.code,
      expiresMinutes: String(otp.expiresMinutes),
    });
    return ok(res, { sent: true, mail });
  } catch (e) {
    next(e);
  }
});

router.post("/verify-otp", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").toLowerCase();
    const code = String(req.body?.code || "");
    verifyRegisterOtp(email, code);
    const user = await markEmailVerified(email);
    await sendTemplate(user.email, "register-confirm", { name: user.name });
    return ok(res, { user: publicUser(user), verified: true });
  } catch (e) {
    next(e);
  }
});

router.post("/forgot", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").toLowerCase();
    const user = await findUserByEmail(email);
    if (!user) {
      return ok(res, { sent: true });
    }
    const { token, expiresMinutes } = createResetToken(user.email, 30);
    const appUrl = process.env.APP_URL || "http://localhost:3000";
    const resetUrl = `${appUrl}/reset-password?email=${encodeURIComponent(user.email)}&token=${token}`;
    const mail = await sendTemplate(user.email, "forgot-password", {
      name: user.name,
      resetUrl,
      expiresMinutes: String(expiresMinutes),
    });
    return ok(res, { sent: true, mail });
  } catch (e) {
    next(e);
  }
});

router.post("/reset", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").toLowerCase();
    const token = String(req.body?.token || "");
    const password = String(req.body?.password || "");
    consumeResetToken(email, token);
    const user = await updatePassword(email, password);
    await sendTemplate(user.email, "password-changed", { name: user.name });
    return ok(res, { reset: true, user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

router.get("/mail-status", requireAuth, (req: AuthRequest, res, next) => {
  try {
    if (req.user?.role !== "admin") {
      throw new ApiError(403, "forbidden", "Admin only");
    }
    return ok(res, mailStatus());
  } catch (e) {
    next(e);
  }
});

export default router;
