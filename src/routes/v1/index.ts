/**
 * Server Block S1–S10 — API v1
 */

import { Router } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import plansRouter from "./plans.js";
import billingRouter from "./billing.js";
import adminRouter from "./admin.js";
import workspaceRouter from "./workspace.js";
import agentRouter from "./agent.js";
import openapiRouter from "./openapi.js";
import { notFoundV1, v1ErrorHandler } from "../../lib/apiResponse.js";
import { rateLimitV1 } from "../../lib/rateLimitV1.js";

const v1 = Router();

v1.use(rateLimitV1);

v1.use(healthRouter);
v1.use(openapiRouter);
v1.use("/auth", authRouter);
v1.use("/plans", plansRouter);
v1.use("/billing", billingRouter);
v1.use("/admin", adminRouter);
v1.use("/workspace", workspaceRouter);
v1.use("/agent", agentRouter);

v1.use(notFoundV1);
v1.use(v1ErrorHandler);

export default v1;
