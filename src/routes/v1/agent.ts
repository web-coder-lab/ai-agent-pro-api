/**
 * Phase S7 — Agent chat proxy (auth + plan gates)
 */

import { Router } from "express";
import { ok, ApiError } from "../../lib/apiResponse.js";
import { requireAuth, type AuthRequest } from "../../lib/auth.js";
import { requireFeature } from "../../lib/plans.js";
import db from "../../db/schema.js";
import { simpleChat, runAgentLoop } from "../../lib/agent.js";

const router = Router();
router.use(requireAuth);

router.post("/chat", requireFeature("chat"), async (req: AuthRequest, res, next) => {
  try {
    const content = String(req.body?.content || "");
    if (!content) throw new ApiError(400, "bad_request", "content required");
    let convId = Number(req.body?.conversationId || 0);
    if (!convId) {
      const c = db.createConversation({
        title: content.slice(0, 40),
        user_id: req.userId,
      });
      convId = c.id;
    }
    const mode = (req.body?.mode || "chat") as any;
    if (mode === "build") {
      // build requires feature
      const { planHasFeature } = await import("../../lib/plans.js");
      if (!planHasFeature(req.user?.plan, "build")) {
        throw new ApiError(403, "plan_required", "Build mode requires weekly+ plan");
      }
    }
    if (mode === "plan" || mode === "build" || mode === "ask") {
      // SSE stream
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      const send = (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      try {
        const result = await runAgentLoop(convId, content, {
          mode,
          onEvent: (ev) => send(ev.event, ev.data),
        });
        send("done", result);
      } catch (e: any) {
        send("error", { message: e.message });
      }
      return res.end();
    }
    const result = await simpleChat(convId, content, { mode: "chat" });
    return ok(res, { conversationId: convId, ...result });
  } catch (e) {
    next(e);
  }
});

export default router;
