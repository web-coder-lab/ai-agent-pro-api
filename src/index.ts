// Load .env first (SMTP, JWT, Firebase)
import { config as dotenvConfig } from "dotenv";
dotenvConfig();

import express from "express";
import cors from "cors";
import v1Router from "./routes/v1/index.js";
import { join } from "path";
import { initFirebase, firebaseStatus } from "./lib/firebase.js";
import { seedDefaultAdmin } from "./lib/auth.js";
import { runCode, listLanguages, detectAvailableLanguages, selfTest } from "./lib/codeRunner.js";
import { TOOL_DEFINITIONS, dispatchTool, listToolNames } from "./lib/tools.js";
import {
  listTree, readWorkspaceFile, writeWorkspaceFile, deleteWorkspacePath,
  createDirectory, renamePath, exportZip, listAllFiles, importZip, importZipFromBase64,
} from "./lib/fileManager.js";
import db from "./db/schema.js";
import OpenAI from "openai";
import { simpleChat, runAgentLoop, executePlan, getLastPlan, type AgentMode } from "./lib/agent.js";
import { log, getLogs, clearLogs } from "./lib/logger.js";
import { createSession, getSession, listSessions, destroySession, execInSession } from "./lib/terminal.js";
import {
  getPreviewState, setPreviewEntry, registerPort, unregisterPort, listPorts,
  resolvePreviewPath, contentTypeFor, readPreviewFile, workspacePublicUrl,
} from "./lib/preview.js";
import {
  listProcesses, getProcess, startProcess, stopProcess, stopAll,
  readProcessLog, startPreset,
} from "./lib/processManager.js";
import { detectManifests, installDependencies, addPackage } from "./lib/depsManager.js";
import {
  gitInit, gitStatus, gitDiff, gitLog, gitAdd, gitCommit, gitShow, isGitRepo,
} from "./lib/gitManager.js";
import {
  listTasks, getTask, createTask, createPlanTasks, cancelTask,
  clearDone, queueStats, ensureWorker,
} from "./lib/taskQueue.js";
import {
  listPatches, getPatch, proposePatch, enrichHunks, applyPatch, rejectPatch,
  createCheckpoint, listCheckpoints, rollbackTo, patchToDiff,
} from "./lib/patchEngine.js";
import {
  listSkills, getSkill, registerSkill, runSkill,
  listPlugins, runPluginTool, listWorkflows, runWorkflow, registerWorkflow,
  mcpCatalog, onHook,
} from "./lib/skills.js";
import {
  getConnectorConfig, setConnectorConfig, listDeliveries,
  sendEmail, sendSlack, sendWebhook, createJiraIssue, deliverZipEmail,
} from "./lib/connectors.js";
import {
  hasAdminToken, setAdminToken, verifyAdminToken,
  setSecret, getSecret, listSecretKeys, deleteSecret,
  getPermissions, setPermissions, isToolAllowed,
  requestApproval, listApprovals, decideApproval,
  listAudit, audit, adminOverview,
} from "./lib/security.js";
import {
  listCredentials, getCredentialMeta, addCredential, updateCredential,
  revokeCredential, findCredential, credentialsForAgent, githubApi, brokerStats,
} from "./lib/credentialBroker.js";
import {
  routeModel, getRouteRules, setRouteRules, getBudget, setBudgetLimits,
  routerStatus, taskFromMode, type TaskKind,
} from "./lib/modelRouter.js";
import {
  listProjects, getMemory, setSummary, addEntry, updateEntry, deleteEntry,
  searchMemory, memoryContext, ensureDefaultProject,
} from "./lib/workspaceMemory.js";
import {
  buildGraph, loadGraph, queryGraph, graphSummary, getGraphOrEmpty,
} from "./lib/knowledgeGraph.js";
import {
  getCodeServerStatus, startCodeServer, stopCodeServer,
  installExtension, listExtensions, ideWriteFile, ideReadFile, installInstructions,
} from "./lib/codeServer.js";
import {
  listExtensions as vscodeListExt, installExtension as vscodeInstallExt,
  uninstallExtension, getSettings, mergeSettings, listProfiles, applyProfile,
  getLaunch, setLaunch, ensureDefaultLaunch, getTasks, setTasks, status as vscodeStatus,
  getRecommendedExtensions, setRecommendedExtensions,
} from "./lib/vscodeController.js";
import {
  listWorkers, getWorker, spawnWorker, stopWorker, stopAllWorkers,
  runWorker, spawnSquad, runSquadOnce, workerStats,
} from "./lib/workers.js";
import {
  listRoles, orgChart, listMissions, getMission, createMission,
  advanceMission, nextActions, missionStats,
} from "./lib/company.js";
import {
  runAsRole, teamHandOff, activeMissionsForRole, suggestAdvance,
} from "./lib/teamLoop.js";
import {
  openUrl, listTabs, getTab, readTabText, researchTopic,
  listReports, readReport, browserStatus, chromeDumpText,
} from "./lib/browserAgent.js";
import {
  ingestReport, researchAndIngest, listIngests, parseReportMarkdown, findRelatedMemory,
} from "./lib/researchIngest.js";
import {
  openSession, closeSession, closeAll, listBrokerSessions, touchSession,
  getLimits, setLimits, sessionStats, enforceLimits,
} from "./lib/sessionBroker.js";
import {
  listVps, getVps, registerVps, updateVps, removeVps, checkVps, execOnVps, vpsStats,
} from "./lib/vpsBroker.js";
import {
  listLocalAiNodes, getLocalAiNode, registerLocalAi, removeLocalAi,
  checkLocalAi, localChat, monitorCluster, deployOllamaHint,
  clusterStats, ensureDefaultLocalNode, pickLocalForTask,
} from "./lib/localAiCluster.js";
import {
  detectDeployTools, generateDockerfile, generateCompose, generatePm2Ecosystem,
  generateNginxConfig, generateCaddyfile, generateDeployPack, sslRenewHint,
  dockerBuild, composeUp, composeDown, pm2Start, pm2Status,
  deployToVpsHint, listDeployLogs, deployStatus,
} from "./lib/deployAgents.js";
import {
  detectKubeTools, generateK8sDeployment, generateLbConfig, generateCdnHints,
  kubectlApply, fullStackGenerate, recentK8sLog,
} from "./lib/k8sLbCdn.js";
import {
  createTwin, listTwins, getTwin, simulate, canPromote, listSimulations, twinStats,
} from "./lib/digitalTwin.js";
import {
  collectMetrics, metricsHistory, evaluateAlerts, createInfraSnapshot,
  listInfraSnapshots, restoreSnapshotPreview, infraStatus, softRestartHint,
} from "./lib/infraMonitor.js";
import {
  listIncidents, getIncident, scanEmergencies, mitigateIncident,
  approveAction, resolveIncident, emergencyStats, openIncident,
} from "./lib/emergency.js";
import {
  runSelfImprove, listImproveReports, getImproveReport,
} from "./lib/selfImprove.js";
import {
  recordDecision, listDecisions, getDecision, rollbackDecision, timeTravelStats,
} from "./lib/timeTravel.js";
import { commandCenterSnapshot, commandCenterSummary } from "./lib/commandCenter.js";
import {
  rateLimitMiddleware, getPolicy, setPolicy, applyPreset,
  hardeningStatus, redactSecrets, isDangerousCommand,
} from "./lib/hardening.js";

const app = express();
app.set("trust proxy", 1); // Render / reverse proxy
app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
    : true,
  credentials: true,
}));
app.use(rateLimitMiddleware);
app.use(express.json({ limit: "10mb" }));

// Phase S1 — versioned public API
app.use("/api/v1", v1Router);
app.use(express.static(join(process.cwd(), "public")));

// Block legacy admin UI paths — API server only
app.get(["/admin", "/admin.html", "/admin/", "/Admin.html"], (_req, res) => {
  res.status(404).json({
    error: "admin_ui_removed",
    message: "Admin panel is not on API servers. Use aap-control-plane /admin",
  });
});


// Admin token middleware for sensitive routes
function requireAdmin(req: any, res: any, next: any) {
  if (!hasAdminToken()) return next();
  const token = req.headers["x-admin-token"] || req.query.adminToken;
  if (!verifyAdminToken(String(token || ""))) {
    return res.status(401).json({ error: "Unauthorized — valid x-admin-token required" });
  }
  next();
}



const PORT = Number(process.env.PORT) || 3000;

// Init Firebase early + seed owner admin
const fb = initFirebase();
void seedDefaultAdmin();

// Health
app.get("/api/health", (_req, res) => {
  const fbStatus = firebaseStatus();
  res.json({
    status: "ok",
    ready: true,
    version: "2.52.0-firebase",
    phases: "1-48",
    engine: "pure-js + firebase",
    firebase: fbStatus,
    smtp: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
    time: new Date().toISOString(),
  });
});

// Languages
app.get("/api/languages", async (_req, res) => {
  try {
    const all = listLanguages();
    const available = await detectAvailableLanguages();
    res.json({ total: all.length, available: available.map(a => a.id), languages: all });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Tools catalog
app.get("/api/tools", (_req, res) => {
  res.json({
    tools: listToolNames(),
    definitions: TOOL_DEFINITIONS.map(t => ({
      name: t.function.name,
      description: t.function.description,
    })),
  });
});

// Self-test core languages
app.get("/api/execute/self-test", async (_req, res) => {
  try {
    const results = await selfTest();
    res.json({ results, passed: results.filter(r => r.ok).length, total: results.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Execute
app.post("/api/execute", async (req, res) => {
  try {
    const { language = "python", code } = req.body;
    if (!code) return res.status(400).json({ error: "code required" });
    const result = await runCode(language, code);
    log("exec", `Ran ${result.language} exit=${result.exitCode} ${result.executionTime}ms`, "execute", {
      language: result.language,
      exitCode: result.exitCode,
    });
    db.addExecutionLog({
      language: result.language,
      code,
      output: result.stdout,
      error_output: result.stderr,
      exit_code: result.exitCode,
      execution_time: result.executionTime
    });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Providers
app.get("/api/providers", (_req, res) => {
  res.json(db.listProviders());
});

app.post("/api/providers", (req, res) => {
  const { name, type, apiKey, baseUrl, defaultModel, isActive = true } = req.body;
  if (!name || !type) return res.status(400).json({ error: "name and type required" });
  const item = db.createProvider({
    name,
    type,
    api_key: apiKey || null,
    base_url: baseUrl || null,
    default_model: defaultModel || null,
    is_active: isActive ? 1 : 0
  });
  res.status(201).json(item);
});

app.delete("/api/providers/:id", (req, res) => {
  db.deleteProvider(Number(req.params.id));
  res.status(204).end();
});

// Conversations
app.get("/api/conversations", (_req, res) => {
  res.json(db.listConversations());
});

app.post("/api/conversations", (req, res) => {
  const item = db.createConversation(req.body);
  res.status(201).json(item);
});

app.get("/api/conversations/:id", (req, res) => {
  const conv = db.getConversation(Number(req.params.id));
  if (!conv) return res.status(404).json({ error: "not found" });
  res.json(conv);
});

app.patch("/api/conversations/:id", (req, res) => {
  const updated = db.updateConversation(Number(req.params.id), {
    title: req.body.title,
    systemPrompt: req.body.systemPrompt,
    model: req.body.model,
  });
  if (!updated) return res.status(404).json({ error: "not found" });
  res.json(updated);
});

app.delete("/api/conversations/:id", (req, res) => {
  db.deleteConversation(Number(req.params.id));
  res.status(204).end();
});

// Simple chat
app.post("/api/conversations/:id/messages", async (req, res) => {
  try {
    const convId = Number(req.params.id);
    const { content, model, providerId } = req.body;
    if (!content) return res.status(400).json({ error: "content required" });
    const mode = (req.body.mode || "chat") as AgentMode;
    const result = await simpleChat(convId, content, {
      model,
      providerId: providerId ? Number(providerId) : undefined,
      mode,
    });
    // auto-title first message
    const conv = db.getConversation(convId);
    if (conv && (conv.title === "New Chat" || !conv.title)) {
      db.updateConversation(convId, {
        title: content.slice(0, 48) + (content.length > 48 ? "…" : ""),
      });
    }
    res.json({
      role: "assistant",
      content: result.content,
      tokensUsed: result.tokensUsed,
      model: result.model,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/conversations/:id/agent", async (req, res) => {
  const convId = Number(req.params.id);
  const { content, model, providerId } = req.body;
  if (!content) return res.status(400).json({ error: "content required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // auto-title
    const conv = db.getConversation(convId);
    if (conv && (conv.title === "New Chat" || !conv.title)) {
      db.updateConversation(convId, {
        title: content.slice(0, 48) + (content.length > 48 ? "…" : ""),
      });
    }

    const mode = (req.body.mode || "build") as AgentMode;
    await runAgentLoop(convId, content, {
      model,
      providerId: providerId ? Number(providerId) : undefined,
      mode,
      onEvent: (ev) => send(ev.event, ev.data),
    });
    res.end();
  } catch (e: any) {
    send("error", { message: e.message });
    res.end();
  }
});


app.post("/api/conversations/:id/execute-plan", async (req, res) => {
  const convId = Number(req.params.id);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  try {
    await executePlan(convId, {
      model: req.body?.model,
      providerId: req.body?.providerId ? Number(req.body.providerId) : undefined,
      onEvent: (ev) => send(ev.event, ev.data),
    });
    res.end();
  } catch (e: any) {
    send("error", { message: e.message });
    res.end();
  }
});

app.get("/api/conversations/:id/plan", (req, res) => {
  const plan = getLastPlan(Number(req.params.id));
  res.json({ plan });
});

// Files (Phase 3)
app.get("/api/files", async (req, res) => {
  try {
    const path = (req.query.path as string) || ".";
    const tree = await listTree(path);
    res.json({ files: tree, path });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/files/list-flat", async (req, res) => {
  try {
    const files = await listAllFiles((req.query.path as string) || ".");
    res.json({ files });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/files/read", async (req, res) => {
  try {
    const result = await readWorkspaceFile(String(req.query.path || ""));
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/files", async (req, res) => {
  try {
    const { path, content } = req.body;
    const result = await writeWorkspaceFile(path, content ?? "");
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/files/mkdir", async (req, res) => {
  try {
    const result = await createDirectory(req.body.path);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/files/rename", async (req, res) => {
  try {
    const result = await renamePath(req.body.from, req.body.to);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/files", async (req, res) => {
  try {
    const p = (req.query.path as string) || req.body?.path;
    const result = await deleteWorkspacePath(p);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/files/export-zip", async (req, res) => {
  try {
    const result = await exportZip(req.body?.path || ".");
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Memory
app.get("/api/memory", (_req, res) => {
  res.json({ memories: db.listMemory() });
});

app.post("/api/memory", (req, res) => {
  db.setMemory(req.body.key, req.body.value, req.body.category);
  res.json({ ok: true });
});

// Executions
// Logs (Phase 10)
// Terminal (Phase 11)
app.post("/api/terminal/session", (_req, res) => {
  res.status(201).json(createSession());
});

app.get("/api/terminal/sessions", (_req, res) => {
  res.json({ sessions: listSessions() });
});

app.get("/api/terminal/session/:id", (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: "session not found" });
  res.json(s);
});

app.delete("/api/terminal/session/:id", (req, res) => {
  destroySession(req.params.id);
  res.status(204).end();
});

app.post("/api/terminal/exec", async (req, res) => {
  try {
    const { sessionId, command } = req.body || {};
    if (!command) return res.status(400).json({ error: "command required" });
    let sid = sessionId;
    if (!sid || !getSession(sid)) {
      sid = createSession().id;
    }
    const result = await execInSession(sid, command);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/logs", (req, res) => {
  res.json({
    logs: getLogs({
      limit: Number(req.query.limit) || 100,
      filter: req.query.filter ? String(req.query.filter) : undefined,
      level: req.query.level ? String(req.query.level) : undefined,
    }),
  });
});

app.delete("/api/logs", (_req, res) => {
  clearLogs();
  log("info", "Logs cleared by API", "api");
  res.json({ ok: true });
});

app.post("/api/logs", (req, res) => {
  const level = (req.body?.level || "info") as any;
  const entry = log(level, req.body?.message || "", req.body?.source || "client", req.body?.data);
  res.status(201).json(entry);
});

app.get("/api/executions", (_req, res) => {
  res.json({ logs: db.listExecutions() });
});

// SPA fallback



app.get("/api/version", (_req, res) => {
  res.json({
    name: "ai-agent-pro",
    version: "2.48.0",
    phases: "1-48",
    node: process.version,
  });
});

app.get("/api/ready", (_req, res) => {
  res.json({
    ready: true,
    version: "2.48.0",
    phases: "1-48",
    ts: new Date().toISOString(),
  });
});

// Hardening (Phase 47)
app.get("/api/hardening", (_req, res) => {
  res.json(hardeningStatus());
});

app.get("/api/hardening/policy", (_req, res) => {
  res.json(getPolicy());
});

app.post("/api/hardening/policy", (req, res) => {
  res.json(setPolicy(req.body || {}));
});

app.post("/api/hardening/preset/:name", (req, res) => {
  const name = req.params.name as "default" | "strict" | "dev";
  if (!["default", "strict", "dev"].includes(name)) {
    return res.status(400).json({ error: "preset must be default|strict|dev" });
  }
  res.json(applyPreset(name));
});

app.post("/api/hardening/redact", (req, res) => {
  res.json({ redacted: redactSecrets(String(req.body?.text || "")) });
});

// Command Center (Phase 46)
app.get("/api/command-center", async (_req, res) => {
  try {
    const snap = await commandCenterSnapshot();
    res.json({ summary: commandCenterSummary(snap), ...snap });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/command-center/summary", async (_req, res) => {
  try {
    const snap = await commandCenterSnapshot();
    res.json(commandCenterSummary(snap));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Time Travel (Phase 45)
app.get("/api/time-travel", (_req, res) => {
  res.json({ decisions: listDecisions(50), stats: timeTravelStats() });
});

app.post("/api/time-travel", (req, res) => {
  try {
    const { actor, action, reason, payload, checkpointId, reversible } = req.body || {};
    if (!action || !reason) return res.status(400).json({ error: "action and reason required" });
    res.status(201).json(recordDecision({ actor: actor || "admin", action, reason, payload, checkpointId, reversible }));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/time-travel/:id/rollback", async (req, res) => {
  res.json(await rollbackDecision(req.params.id));
});

app.get("/api/time-travel/:id", (req, res) => {
  const d = getDecision(req.params.id);
  if (!d) return res.status(404).json({ error: "not found" });
  res.json(d);
});

// Self-Improve (Phase 44)
app.get("/api/self-improve", (_req, res) => {
  res.json({ reports: listImproveReports() });
});

app.post("/api/self-improve/run", async (req, res) => {
  try {
    res.json(await runSelfImprove({ maxFiles: Number(req.body?.maxFiles) || 150 }));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/self-improve/:id", (req, res) => {
  const r = getImproveReport(req.params.id);
  if (!r) return res.status(404).json({ error: "not found" });
  res.json(r);
});

// Emergency Response (Phase 43)
app.get("/api/emergency", (_req, res) => {
  res.json({ incidents: listIncidents(), stats: emergencyStats() });
});

app.get("/api/emergency/:id", (req, res) => {
  const i = getIncident(req.params.id);
  if (!i) return res.status(404).json({ error: "not found" });
  res.json(i);
});

app.post("/api/emergency/scan", async (_req, res) => {
  try {
    res.json(await scanEmergencies());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/emergency/:id/mitigate", async (req, res) => {
  try {
    res.json(await mitigateIncident(req.params.id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/emergency/:id/approve", (req, res) => {
  try {
    res.json(approveAction(req.params.id, String(req.body?.actionId || ""), !!req.body?.approved, req.body?.note));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/emergency/:id/resolve", (req, res) => {
  try {
    res.json(resolveIncident(req.params.id, req.body?.note));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Infrastructure AI (Phase 42)
app.get("/api/infra", async (_req, res) => {
  res.json(await infraStatus());
});

app.get("/api/infra/metrics", async (_req, res) => {
  const m = await collectMetrics();
  res.json({ metrics: m, alerts: evaluateAlerts(m), history: metricsHistory(20) });
});

app.post("/api/infra/snapshot", async (req, res) => {
  res.json(await createInfraSnapshot(req.body?.label));
});

app.get("/api/infra/snapshots", (_req, res) => {
  res.json({ snapshots: listInfraSnapshots() });
});

app.post("/api/infra/snapshots/:id/restore-preview", async (req, res) => {
  res.json(await restoreSnapshotPreview(req.params.id));
});

app.get("/api/infra/restart-hint", async (_req, res) => {
  res.json(await softRestartHint());
});

// Digital Twin (Phase 41)
app.get("/api/twins", (_req, res) => {
  res.json({ twins: listTwins(), stats: twinStats() });
});

app.post("/api/twins", async (req, res) => {
  try {
    res.status(201).json(await createTwin(req.body || {}));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/twins/:id", (req, res) => {
  const t = getTwin(req.params.id);
  if (!t) return res.status(404).json({ error: "not found" });
  res.json(t);
});

app.post("/api/twins/:id/simulate", async (req, res) => {
  try {
    res.json(await simulate(req.params.id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/twins/:id/promote", (req, res) => {
  res.json(canPromote(req.params.id));
});

app.get("/api/simulations", (req, res) => {
  res.json({ simulations: listSimulations(req.query.twinId as string | undefined) });
});

// K8s / LB / CDN (Phase 40)
app.get("/api/k8s", async (_req, res) => {
  res.json({ tools: await detectKubeTools(), recent: recentK8sLog().slice(0, 12) });
});

app.post("/api/k8s/generate", async (req, res) => {
  res.json(await generateK8sDeployment(req.body || {}));
});

app.post("/api/k8s/lb", async (req, res) => {
  res.json(await generateLbConfig(req.body || {}));
});

app.post("/api/k8s/cdn", async (req, res) => {
  res.json(await generateCdnHints(req.body || {}));
});

app.post("/api/k8s/full", async (req, res) => {
  res.json(await fullStackGenerate(req.body || {}));
});

app.post("/api/k8s/apply", async (req, res) => {
  res.json(await kubectlApply(req.body?.dir));
});

// Deploy Agents (Phase 39)
app.get("/api/deploy", async (_req, res) => {
  try {
    res.json(await deployStatus());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/deploy/pack", async (req, res) => {
  try {
    res.json(await generateDeployPack(req.body || {}));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/deploy/dockerfile", async (req, res) => {
  res.json(await generateDockerfile(req.body || {}));
});

app.post("/api/deploy/compose", async (req, res) => {
  res.json(await generateCompose(req.body || {}));
});

app.post("/api/deploy/pm2", async (req, res) => {
  res.json(await generatePm2Ecosystem(req.body || {}));
});

app.post("/api/deploy/nginx", async (req, res) => {
  res.json(await generateNginxConfig(req.body || {}));
});

app.post("/api/deploy/caddy", async (req, res) => {
  res.json(await generateCaddyfile(req.body || {}));
});

app.get("/api/deploy/ssl-hint", (req, res) => {
  res.json(sslRenewHint(req.query.domain as string | undefined));
});

app.post("/api/deploy/docker/build", async (req, res) => {
  res.json(await dockerBuild(req.body?.tag));
});

app.post("/api/deploy/compose/up", async (_req, res) => {
  res.json(await composeUp());
});

app.post("/api/deploy/compose/down", async (_req, res) => {
  res.json(await composeDown());
});

app.post("/api/deploy/pm2/start", async (req, res) => {
  res.json(await pm2Start(req.body?.configPath));
});

app.get("/api/deploy/pm2/status", async (_req, res) => {
  res.json(await pm2Status());
});

app.post("/api/deploy/vps/:id/hint", async (req, res) => {
  try {
    res.json(await deployToVpsHint(req.params.id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/deploy/logs", (_req, res) => {
  res.json({ logs: listDeployLogs() });
});

// Local AI Cluster (Phase 38)
app.get("/api/local-ai", (_req, res) => {
  ensureDefaultLocalNode();
  res.json({ nodes: listLocalAiNodes(), stats: clusterStats() });
});

app.post("/api/local-ai", (req, res) => {
  try {
    res.status(201).json(registerLocalAi(req.body || {}));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/local-ai/:id", (req, res) => {
  const ok = removeLocalAi(req.params.id);
  if (!ok) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

app.post("/api/local-ai/:id/check", async (req, res) => {
  try {
    res.json(await checkLocalAi(req.params.id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/local-ai/monitor", async (_req, res) => {
  try {
    res.json(await monitorCluster());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/local-ai/:id/chat", async (req, res) => {
  try {
    const messages = req.body?.messages;
    if (!messages?.length) return res.status(400).json({ error: "messages required" });
    res.json(await localChat({
      nodeId: req.params.id,
      messages,
      model: req.body?.model,
      callerVpsId: req.body?.callerVpsId || "admin",
    }));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/local-ai/deploy-hint/:vpsId", async (req, res) => {
  try {
    res.json(await deployOllamaHint(req.params.vpsId));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// VPS / SSH (Phase 37)
app.get("/api/vps", (_req, res) => {
  res.json({ targets: listVps(), stats: vpsStats() });
});

app.get("/api/vps/:id", (req, res) => {
  const t = getVps(req.params.id);
  if (!t) return res.status(404).json({ error: "not found" });
  res.json(t);
});

app.post("/api/vps", (req, res) => {
  try {
    res.status(201).json(registerVps(req.body || {}));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/vps/:id", (req, res) => {
  try {
    res.json(updateVps(req.params.id, req.body || {}));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/vps/:id", (req, res) => {
  const ok = removeVps(req.params.id);
  if (!ok) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

app.post("/api/vps/:id/check", async (req, res) => {
  try {
    res.json(await checkVps(req.params.id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/vps/:id/exec", async (req, res) => {
  try {
    const command = req.body?.command;
    if (!command) return res.status(400).json({ error: "command required" });
    res.json(await execOnVps(req.params.id, String(command), { deviceId: req.body?.deviceId }));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Session Broker (Phase 36)
app.get("/api/sessions", (req, res) => {
  res.json({
    sessions: listBrokerSessions({
      deviceId: req.query.deviceId as string | undefined,
      vpsId: req.query.vpsId as string | undefined,
      kind: req.query.kind as any,
    }),
    stats: sessionStats(),
  });
});

app.get("/api/sessions/stats", (_req, res) => {
  res.json(sessionStats());
});

app.get("/api/sessions/limits", (_req, res) => {
  res.json(getLimits());
});

app.post("/api/sessions/limits", (req, res) => {
  res.json(setLimits(req.body || {}));
});

app.post("/api/sessions", (req, res) => {
  const result = openSession(req.body || {});
  if (!result.ok) return res.status(429).json(result);
  res.status(201).json(result.session);
});

app.post("/api/sessions/:id/touch", (req, res) => {
  const s = touchSession(req.params.id);
  if (!s) return res.status(404).json({ error: "not found" });
  res.json(s);
});

app.delete("/api/sessions/:id", (req, res) => {
  const ok = closeSession(req.params.id);
  if (!ok) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

app.post("/api/sessions/close-all", (req, res) => {
  res.json(closeAll(req.body || {}));
});

app.post("/api/sessions/enforce", (_req, res) => {
  res.json(enforceLimits());
});

// Research Ingest (Phase 35)
app.post("/api/research/run", async (req, res) => {
  try {
    const topic = req.body?.topic;
    if (!topic) return res.status(400).json({ error: "topic required" });
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : undefined;
    const autoIngest = req.body?.ingest !== false;
    if (autoIngest) {
      res.json(await researchAndIngest(String(topic), urls));
    } else {
      const { researchTopic } = await import("./lib/browserAgent.js");
      res.json(await researchTopic(String(topic), urls));
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/research/ingest/:reportId", (req, res) => {
  try {
    res.json(ingestReport(req.params.reportId, { projectId: req.body?.projectId }));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/research/ingests", (_req, res) => {
  res.json({ ingests: listIngests() });
});

app.get("/api/research/related", (req, res) => {
  const q = String(req.query.q || "");
  res.json({ results: findRelatedMemory(q) });
});

// Browser / Research (Phase 34)
app.get("/api/browser", (_req, res) => {
  res.json({ ...browserStatus(), tabs: listTabs() });
});

app.post("/api/browser/open", async (req, res) => {
  try {
    const url = req.body?.url;
    if (!url) return res.status(400).json({ error: "url required" });
    res.json(await openUrl(String(url)));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/browser/tabs/:id", (req, res) => {
  const tab = getTab(req.params.id);
  if (!tab) return res.status(404).json({ error: "not found" });
  res.json({ ...tab, text: readTabText(req.params.id) });
});

app.post("/api/browser/research", async (req, res) => {
  try {
    const topic = req.body?.topic;
    if (!topic) return res.status(400).json({ error: "topic required" });
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : undefined;
    res.json(await researchTopic(String(topic), urls));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/browser/reports", (_req, res) => {
  res.json({ reports: listReports() });
});

app.get("/api/browser/reports/:id", (req, res) => {
  try {
    res.type("text/markdown").send(readReport(req.params.id));
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
});

app.post("/api/browser/chrome-dump", async (req, res) => {
  try {
    res.json(await chromeDumpText(String(req.body?.url || "")));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Team loops (Phase 33)
app.get("/api/team/missions/:roleId", (req, res) => {
  res.json({ missions: activeMissionsForRole(req.params.roleId as any) });
});

app.post("/api/team/run", async (req, res) => {
  const { roleId, missionId, message, conversationId, model, providerId } = req.body || {};
  if (!roleId || !message) return res.status(400).json({ error: "roleId and message required" });

  // Ensure conversation
  let convId = conversationId ? Number(conversationId) : 0;
  if (!convId) {
    const c = db.createConversation(String(message).slice(0, 60));
    convId = c.id;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await runAsRole({
      roleId,
      missionId,
      message,
      convId,
      model,
      providerId: providerId ? Number(providerId) : undefined,
      onEvent: (ev) => send(ev.event, ev.data),
    });
    const suggestion = missionId ? suggestAdvance(roleId, missionId) : null;
    send("done", { ...result, suggestAdvance: suggestion, conversationId: convId });
    res.end();
  } catch (e: any) {
    send("error", { message: e.message });
    res.end();
  }
});

app.post("/api/team/handoff", (req, res) => {
  try {
    const { missionId, action, from, note } = req.body || {};
    if (!missionId || !action) return res.status(400).json({ error: "missionId and action required" });
    res.json(teamHandOff(missionId, action, from || "admin", note));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Company + Missions (Phase 32)
app.get("/api/company/roles", (_req, res) => {
  res.json({ roles: listRoles(), org: orgChart() });
});

app.get("/api/missions", (req, res) => {
  res.json({
    missions: listMissions(req.query.status as any),
    stats: missionStats(),
  });
});

app.get("/api/missions/:id", (req, res) => {
  const m = getMission(req.params.id);
  if (!m) return res.status(404).json({ error: "not found" });
  res.json({ ...m, next: nextActions(m.status) });
});

app.post("/api/missions", (req, res) => {
  try {
    const { title, goal, mode, successCriteria, assigneeRoles } = req.body || {};
    if (!title || !goal) return res.status(400).json({ error: "title and goal required" });
    res.status(201).json(createMission({ title, goal, mode, successCriteria, assigneeRoles }));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/missions/:id/advance", (req, res) => {
  try {
    const action = req.body?.action;
    if (!action) return res.status(400).json({ error: "action required" });
    const m = advanceMission(req.params.id, action, {
      from: req.body?.from,
      note: req.body?.note,
    });
    res.json({ ...m, next: nextActions(m.status) });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Background Workers (Phase 31)
app.get("/api/workers", (req, res) => {
  const ws = String(req.query.workspaceId || "default");
  res.json({ workers: listWorkers(ws), stats: workerStats() });
});

app.post("/api/workers", (req, res) => {
  try {
    const w = spawnWorker(req.body || {});
    res.status(201).json(w);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/workers/squad", (req, res) => {
  const ws = req.body?.workspaceId || "default";
  res.status(201).json({ workers: spawnSquad(ws), stats: workerStats() });
});

app.post("/api/workers/squad/run", async (req, res) => {
  try {
    const results = await runSquadOnce(req.body?.workspaceId || "default");
    res.json({ results, stats: workerStats() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/workers/:id/run", async (req, res) => {
  try {
    res.json(await runWorker(req.params.id, req.body?.payload));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/workers/:id/stop", (req, res) => {
  const w = stopWorker(req.params.id);
  if (!w) return res.status(404).json({ error: "not found" });
  res.json(w);
});

app.post("/api/workers/stop-all", (req, res) => {
  stopAllWorkers(req.body?.workspaceId || "default");
  res.json({ ok: true, stats: workerStats() });
});

// VS Code Controller (Phase 30)
app.get("/api/vscode", (_req, res) => {
  res.json(vscodeStatus());
});

app.get("/api/vscode/extensions", async (_req, res) => {
  res.json(await vscodeListExt());
});

app.post("/api/vscode/extensions/install", async (req, res) => {
  try {
    res.json(await vscodeInstallExt(String(req.body?.id || "")));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/vscode/extensions/uninstall", async (req, res) => {
  try {
    res.json(await uninstallExtension(String(req.body?.id || "")));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/vscode/settings", (_req, res) => {
  res.json(getSettings());
});

app.post("/api/vscode/settings", async (req, res) => {
  try {
    res.json(await mergeSettings(req.body?.patch || req.body || {}));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/vscode/profiles", (_req, res) => {
  res.json({ profiles: listProfiles() });
});

app.post("/api/vscode/profiles/:name/apply", async (req, res) => {
  try {
    res.json(await applyProfile(req.params.name));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/vscode/launch", (_req, res) => {
  res.json(getLaunch());
});

app.post("/api/vscode/launch", async (req, res) => {
  try {
    res.json(await setLaunch(req.body || {}));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/vscode/launch/default", async (_req, res) => {
  res.json(await ensureDefaultLaunch());
});

app.get("/api/vscode/tasks", (_req, res) => {
  res.json(getTasks());
});

app.post("/api/vscode/tasks", async (req, res) => {
  try {
    res.json(await setTasks(req.body || {}));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// code-server (Phase 29)
app.get("/api/code-server", (_req, res) => {
  res.json({ ...getCodeServerStatus(), install: installInstructions() });
});

app.post("/api/code-server/start", async (req, res) => {
  try {
    res.json(await startCodeServer(req.body || {}));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/code-server/stop", (_req, res) => {
  res.json(stopCodeServer());
});

app.get("/api/code-server/extensions", async (_req, res) => {
  res.json(await listExtensions());
});

app.post("/api/code-server/extensions", async (req, res) => {
  const id = req.body?.id || req.body?.extension;
  if (!id) return res.status(400).json({ error: "extension id required" });
  res.json(await installExtension(String(id)));
});

app.post("/api/code-server/write", async (req, res) => {
  try {
    const { path: filePath, content, checkpoint } = req.body || {};
    if (!filePath) return res.status(400).json({ error: "path required" });
    res.json(await ideWriteFile(filePath, content ?? "", { checkpoint }));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/code-server/read", async (req, res) => {
  try {
    res.json(await ideReadFile(String(req.query.path || "")));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Knowledge Graph (Phase 28)
app.get("/api/kg", (_req, res) => {
  res.json(graphSummary());
});

app.post("/api/kg/build", async (_req, res) => {
  try {
    const g = await buildGraph();
    res.json({ ok: true, stats: g.stats, nodes: g.nodes.length, edges: g.edges.length, builtAt: g.builtAt });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/kg/query", (req, res) => {
  res.json(queryGraph({
    type: req.query.type as any,
    q: req.query.q as string | undefined,
    around: req.query.around as string | undefined,
    limit: Number(req.query.limit) || 50,
  }));
});

app.get("/api/kg/full", (_req, res) => {
  const g = getGraphOrEmpty();
  // cap response size
  res.json({
    builtAt: g.builtAt,
    stats: g.stats,
    nodes: g.nodes.slice(0, 500),
    edges: g.edges.slice(0, 1000),
    truncated: g.nodes.length > 500,
  });
});

// Workspace Memory (Phase 27)
app.get("/api/memory/projects", (_req, res) => {
  ensureDefaultProject();
  res.json({ projects: listProjects() });
});

app.get("/api/memory/:projectId/context", (req, res) => {
  res.json({
    projectId: req.params.projectId,
    context: memoryContext(req.params.projectId, Number(req.query.max) || 3000),
  });
});

app.get("/api/memory/:projectId/search", (req, res) => {
  res.json({
    results: searchMemory(
      req.params.projectId,
      String(req.query.q || ""),
      req.query.section as any
    ),
  });
});

app.get("/api/memory/:projectId/entries", (req, res) => {
  res.json(getMemory(req.params.projectId || "default"));
});

app.post("/api/memory/:projectId/summary", (req, res) => {
  res.json(setSummary(req.params.projectId, req.body?.summary || "", req.body?.name));
});

app.post("/api/memory/:projectId/entries", (req, res) => {
  try {
    const { section, title, content, tags } = req.body || {};
    if (!title || content === undefined) return res.status(400).json({ error: "title and content required" });
    res.status(201).json(addEntry(req.params.projectId, { section: section || "custom", title, content, tags }));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/memory/:projectId/entries/:id", (req, res) => {
  const e = updateEntry(req.params.projectId, req.params.id, req.body || {});
  if (!e) return res.status(404).json({ error: "not found" });
  res.json(e);
});

app.delete("/api/memory/:projectId/entries/:id", (req, res) => {
  const ok = deleteEntry(req.params.projectId, req.params.id);
  if (!ok) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

// Model Router (Phase 26)
app.get("/api/router", (_req, res) => {
  res.json(routerStatus());
});

app.get("/api/router/pick", (req, res) => {
  const task = (req.query.task as TaskKind) || "chat";
  const pick = routeModel(task, {
    model: req.query.model as string | undefined,
    providerId: req.query.providerId ? Number(req.query.providerId) : undefined,
  });
  // never return full apiKey
  res.json({ ...pick, apiKey: pick.apiKey ? "[set]" : undefined });
});

app.get("/api/router/rules", (_req, res) => {
  res.json(getRouteRules());
});

app.post("/api/router/rules", (req, res) => {
  res.json(setRouteRules(req.body || {}));
});

app.get("/api/router/budget", (_req, res) => {
  res.json(getBudget());
});

app.post("/api/router/budget", (req, res) => {
  res.json(setBudgetLimits(req.body || {}));
});

// Credential Broker (Phase 25)
app.get("/api/credentials", (_req, res) => {
  res.json({ credentials: listCredentials(), stats: brokerStats() });
});

app.get("/api/credentials/stats", (_req, res) => {
  res.json(brokerStats());
});

app.get("/api/credentials/for-agent", (_req, res) => {
  // Safe list for agent context — masked only
  res.json({ credentials: credentialsForAgent() });
});

app.get("/api/credentials/:id", (req, res) => {
  const c = getCredentialMeta(req.params.id);
  if (!c) return res.status(404).json({ error: "not found" });
  res.json(c); // meta only — no raw secret
});

app.post("/api/credentials", (req, res) => {
  try {
    const { service, label, secret, principal, scopes, projectIds } = req.body || {};
    if (!service || !secret) return res.status(400).json({ error: "service and secret required" });
    const meta = addCredential({ service, label, secret, principal, scopes, projectIds });
    res.status(201).json(meta);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/credentials/:id", (req, res) => {
  try {
    res.json(updateCredential(req.params.id, req.body || {}));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/credentials/:id/revoke", (req, res) => {
  try {
    res.json(revokeCredential(req.params.id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/credentials/github/user", async (_req, res) => {
  try {
    const r = await githubApi("/user");
    res.status(r.status).json(r.data);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/credentials/github/repos", async (req, res) => {
  try {
    const r = await githubApi("/user/repos?per_page=20&sort=updated");
    res.status(r.status).json(r.data);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Admin + Security (Phase 24)
app.get("/api/admin/overview", (_req, res) => {
  res.json(adminOverview());
});

app.post("/api/admin/token", (req, res) => {
  // first-time setup open; rotation requires existing token if set
  if (hasAdminToken()) {
    const token = req.headers["x-admin-token"];
    if (!verifyAdminToken(String(token || ""))) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }
  const result = setAdminToken(req.body?.token);
  res.json({ ok: true, token: result.token, note: "Store this token; it will not be shown again" });
});

app.get("/api/admin/secrets", requireAdmin, (_req, res) => {
  res.json({ keys: listSecretKeys() });
});

app.post("/api/admin/secrets", requireAdmin, (req, res) => {
  const { key, value } = req.body || {};
  if (!key || value === undefined) return res.status(400).json({ error: "key and value required" });
  setSecret(String(key), String(value));
  res.status(201).json({ ok: true, key });
});

app.get("/api/admin/secrets/:key", requireAdmin, (req, res) => {
  const v = getSecret(req.params.key);
  if (v === null) return res.status(404).json({ error: "not found" });
  res.json({ key: req.params.key, value: v });
});

app.delete("/api/admin/secrets/:key", requireAdmin, (req, res) => {
  deleteSecret(req.params.key);
  res.status(204).end();
});

app.get("/api/admin/permissions", (_req, res) => {
  res.json(getPermissions());
});

app.post("/api/admin/permissions", requireAdmin, (req, res) => {
  res.json(setPermissions(req.body || {}));
});

app.get("/api/admin/approvals", (_req, res) => {
  res.json({ approvals: listApprovals(req.query.status as string | undefined) });
});

app.post("/api/admin/approvals/:id", requireAdmin, (req, res) => {
  const approve = req.body?.approve !== false;
  const a = decideApproval(req.params.id, approve);
  if (!a) return res.status(404).json({ error: "not found or already decided" });
  res.json(a);
});

app.get("/api/admin/audit", requireAdmin, (req, res) => {
  res.json({ audit: listAudit(Number(req.query.limit) || 100) });
});

// Connectors (Phase 23)
app.get("/api/connectors", (_req, res) => {
  const c = getConnectorConfig();
  res.json({
    config: {
      ...c,
      slackWebhookUrl: c.slackWebhookUrl ? "[set]" : "",
      genericWebhookUrl: c.genericWebhookUrl ? "[set]" : "",
      jiraApiToken: c.jiraApiToken ? "[set]" : "",
    },
  });
});

app.post("/api/connectors", (req, res) => {
  res.json(setConnectorConfig(req.body || {}));
});

app.get("/api/deliveries", (req, res) => {
  res.json({ deliveries: listDeliveries(Number(req.query.limit) || 50) });
});

app.post("/api/deliveries/email", async (req, res) => {
  try {
    res.status(201).json(await sendEmail(req.body || {}));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/deliveries/slack", async (req, res) => {
  try {
    res.status(201).json(await sendSlack(req.body?.text || req.body?.message || ""));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/deliveries/webhook", async (req, res) => {
  try {
    res.status(201).json(await sendWebhook(req.body?.payload ?? req.body));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/deliveries/jira", async (req, res) => {
  try {
    res.status(201).json(await createJiraIssue(req.body || {}));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/deliveries/zip-email", async (req, res) => {
  try {
    res.status(201).json(await deliverZipEmail(req.body || {}));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Skills / Plugins / Workflows (Phase 22)
app.get("/api/skills", (_req, res) => {
  res.json({ skills: listSkills() });
});

app.get("/api/skills/:id", (req, res) => {
  const s = getSkill(req.params.id);
  if (!s) return res.status(404).json({ error: "not found" });
  res.json(s);
});

app.post("/api/skills", (req, res) => {
  try {
    res.status(201).json(registerSkill(req.body || {}));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/skills/:id/run", async (req, res) => {
  try {
    res.json(await runSkill(req.params.id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/plugins", (_req, res) => {
  res.json({
    plugins: listPlugins().map((p) => ({
      id: p.id,
      name: p.name,
      tools: p.tools.map((t) => ({ name: t.name, description: t.description })),
    })),
  });
});

app.post("/api/plugins/tools/:name", async (req, res) => {
  res.json(await runPluginTool(req.params.name, req.body || {}));
});

app.get("/api/workflows", (_req, res) => {
  res.json({ workflows: listWorkflows() });
});

app.post("/api/workflows/:id/run", async (req, res) => {
  try {
    res.json(await runWorkflow(req.params.id));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/mcp/catalog", (_req, res) => {
  res.json(mcpCatalog());
});

// Patch Engine (Phase 21)
app.get("/api/patches", (req, res) => {
  res.json({ patches: listPatches(req.query.status as string | undefined) });
});

app.get("/api/patches/:id", (req, res) => {
  const p = getPatch(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  res.json({ ...p, diff: patchToDiff(p) });
});

app.post("/api/patches", async (req, res) => {
  try {
    const { title, hunks } = req.body || {};
    if (!title || !Array.isArray(hunks) || !hunks.length) {
      return res.status(400).json({ error: "title and hunks[] required" });
    }
    const enriched = await enrichHunks(hunks);
    const p = proposePatch({ title, hunks: enriched });
    res.status(201).json({ ...p, diff: patchToDiff(p) });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/patches/:id/apply", async (req, res) => {
  try { res.json(await applyPatch(req.params.id)); }
  catch (e: any) { res.status(400).json({ error: e.message }); }
});

app.post("/api/patches/:id/reject", (req, res) => {
  try { res.json(rejectPatch(req.params.id)); }
  catch (e: any) { res.status(400).json({ error: e.message }); }
});

app.get("/api/checkpoints", (_req, res) => {
  res.json({ checkpoints: listCheckpoints() });
});

app.post("/api/checkpoints", async (req, res) => {
  try { res.status(201).json(await createCheckpoint(req.body?.label || "manual")); }
  catch (e: any) { res.status(400).json({ error: e.message }); }
});

app.post("/api/checkpoints/:id/rollback", async (req, res) => {
  try { res.json(await rollbackTo(req.params.id)); }
  catch (e: any) { res.status(400).json({ error: e.message }); }
});

// Task Queue (Phase 20)
app.get("/api/tasks", (req, res) => {
  const status = req.query.status as any;
  res.json({ tasks: listTasks(status ? { status } : undefined), stats: queueStats() });
});

app.get("/api/tasks/stats", (_req, res) => {
  res.json(queueStats());
});

app.get("/api/tasks/:id", (req, res) => {
  const t = getTask(req.params.id);
  if (!t) return res.status(404).json({ error: "not found" });
  res.json(t);
});

app.post("/api/tasks", (req, res) => {
  const { title, type, payload, parentId } = req.body || {};
  if (!title) return res.status(400).json({ error: "title required" });
  res.status(201).json(createTask({ title, type, payload, parentId }));
});

app.post("/api/tasks/plan", (req, res) => {
  const steps = req.body?.steps;
  if (!Array.isArray(steps) || !steps.length) {
    return res.status(400).json({ error: "steps: string[] required" });
  }
  const created = createPlanTasks(steps.map(String), req.body?.title || "Plan");
  res.status(201).json({ tasks: created, stats: queueStats() });
});

app.post("/api/tasks/:id/cancel", (req, res) => {
  const t = cancelTask(req.params.id);
  if (!t) return res.status(404).json({ error: "not found" });
  res.json(t);
});

app.post("/api/tasks/clear-done", (_req, res) => {
  res.json({ cleared: clearDone() });
});

// DB Manager (Phase 17)
app.get("/api/db/stats", (_req, res) => {
  res.json(db.stats());
});

app.get("/api/db/tables", (_req, res) => {
  res.json({ tables: db.listTables() });
});

app.get("/api/db/tables/:name", (req, res) => {
  try {
    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    res.json(db.getTable(req.params.name, limit, offset));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/db/tables/:name", (req, res) => {
  try {
    res.status(201).json(db.insertRow(req.params.name, req.body || {}));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/db/tables/:name/:id", (req, res) => {
  try {
    res.json(db.deleteRow(req.params.name, Number(req.params.id)));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/db/tables/:name/reset", (req, res) => {
  try {
    res.json(db.resetTable(req.params.name));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/db/reset", (_req, res) => {
  res.json(db.resetAll());
});

app.post("/api/db/seed", (_req, res) => {
  res.json(db.seedDemo());
});

app.post("/api/db/backup", (_req, res) => {
  res.json(db.backup());
});

// Import / Export (Phase 16)

app.get("/api/db/query", (req, res) => {
  try {
    const q = String(req.query.q || "");
    const limit = Number(req.query.limit) || 50;
    res.json(db.queryAll(q, limit));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/db/backups", (_req, res) => {
  res.json({ backups: db.listBackups() });
});

app.post("/api/db/restore", (req, res) => {
  try {
    const file = req.body?.file;
    if (!file) return res.status(400).json({ error: "file required" });
    res.json(db.restoreBackup(file));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.patch("/api/db/tables/:name/:id", (req, res) => {
  try {
    res.json(db.updateRow(req.params.name, Number(req.params.id), req.body || {}));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});


app.post("/api/import/zip", async (req, res) => {
  try {
    const { base64, dest } = req.body || {};
    if (!base64) return res.status(400).json({ error: "base64 required" });
    const result = await importZipFromBase64(base64, dest || ".");
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/export/zip", async (req, res) => {
  try {
    const result = await exportZip(req.body?.path || ".");
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/export/zip/download", async (req, res) => {
  try {
    const result = await exportZip(String(req.query.path || "."));
    res.download(result.zipPath, "workspace-export.zip");
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/export/csv/executions", (_req, res) => {
  const logs = db.listExecutions(1000);
  const header = "id,language,exit_code,execution_time,created_at\n";
  const rows = logs.map((l: any) =>
    [l.id, l.language, l.exit_code, l.execution_time, l.created_at]
      .map((x: any) => `"${String(x ?? "").replace(/"/g, "\"")}"`)
      .join(",")
  ).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=executions.csv");
  res.send(header + rows);
});

app.get("/api/export/csv/memory", (_req, res) => {
  const mem = db.listMemory();
  const header = "id,key,value,category,updated_at\n";
  const rows = mem.map((m: any) =>
    [m.id, m.key, m.value, m.category, m.updated_at]
      .map((x: any) => `"${String(x ?? "").replace(/"/g, "\"")}"`)
      .join(",")
  ).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=memory.csv");
  res.send(header + rows);
});

// Git (Phase 15)
app.get("/api/git/status", async (_req, res) => {
  try { res.json(await gitStatus()); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/git/init", async (_req, res) => {
  try { res.json(await gitInit()); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/git/diff", async (req, res) => {
  try {
    res.json(await gitDiff({
      staged: req.query.staged === "1" || req.query.staged === "true",
      path: req.query.path as string | undefined,
    }));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/git/log", async (req, res) => {
  try { res.json(await gitLog(Number(req.query.limit) || 20)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/git/add", async (req, res) => {
  try {
    const paths = req.body?.paths || ["."];
    res.json(await gitAdd(paths));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/git/commit", async (req, res) => {
  try {
    const message = req.body?.message;
    if (!message) return res.status(400).json({ error: "message required" });
    res.json(await gitCommit(message));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/git/show", async (req, res) => {
  try { res.json(await gitShow(String(req.query.ref || "HEAD"))); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Dependency Manager (Phase 14)
app.get("/api/deps", (_req, res) => {
  res.json({ manifests: detectManifests() });
});

app.post("/api/deps/install", async (req, res) => {
  try {
    const kind = req.body?.kind;
    const result = await installDependencies(kind);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/deps/add", async (req, res) => {
  try {
    const { manager, package: pkg } = req.body || {};
    if (!manager || !pkg) return res.status(400).json({ error: "manager and package required" });
    if (manager !== "npm" && manager !== "pip") return res.status(400).json({ error: "manager must be npm|pip" });
    const result = await addPackage(manager, pkg);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Process Manager (Phase 13)
app.get("/api/processes", (_req, res) => {
  res.json({ processes: listProcesses() });
});

app.get("/api/processes/:id", (req, res) => {
  const p = getProcess(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  res.json(p);
});

app.get("/api/processes/:id/logs", (req, res) => {
  const tail = Number(req.query.tail) || 200;
  res.json({ id: req.params.id, log: readProcessLog(req.params.id, tail) });
});

app.post("/api/processes", async (req, res) => {
  try {
    const { name, command, args, cwd, port, env, preset } = req.body || {};
    if (preset) {
      const p = await startPreset(String(preset));
      return res.status(201).json(p);
    }
    if (!command) return res.status(400).json({ error: "command or preset required" });
    const p = await startProcess({ name, command, args, cwd, port, env });
    res.status(201).json(p);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/processes/:id/stop", (req, res) => {
  const p = stopProcess(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  res.json(p);
});

app.post("/api/processes/stop-all", (_req, res) => {
  const n = stopAll();
  res.json({ stopped: n });
});

// Live Preview (Phase 12)
app.get("/api/preview", (_req, res) => {
  res.json({
    ...getPreviewState(),
    url: workspacePublicUrl(),
    ports: listPorts(),
  });
});

app.post("/api/preview/entry", (req, res) => {
  const entry = req.body?.entry || req.body?.path;
  if (!entry) return res.status(400).json({ error: "entry required" });
  res.json({ ...setPreviewEntry(entry), url: workspacePublicUrl(entry) });
});

app.post("/api/preview/ports", (req, res) => {
  const port = Number(req.body?.port);
  if (!port || port < 1 || port > 65535) return res.status(400).json({ error: "valid port required" });
  res.status(201).json(registerPort(port, req.body?.label || "app"));
});

app.delete("/api/preview/ports/:port", (req, res) => {
  unregisterPort(Number(req.params.port));
  res.status(204).end();
});

// Static workspace preview
app.get("/preview", (_req, res) => {
  res.redirect(workspacePublicUrl());
});

app.get("/preview/*", (req, res) => {
  try {
    const sub = req.params[0] || getPreviewState().entry;
    const abs = resolvePreviewPath(sub);
    if (!abs) return res.status(404).send("Not found in workspace");
    res.setHeader("Content-Type", contentTypeFor(abs));
    res.setHeader("Cache-Control", "no-store");
    res.send(readPreviewFile(abs));
  } catch (e: any) {
    res.status(500).send(e.message);
  }
});


ensureWorker();




// API 404 — JSON only (before SPA fallback)
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found", path: req.path });
});

// SPA fallback for non-API GETs
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(join(process.cwd(), "public", "index.html"));
});

// Global error handler
app.use((err: any, _req: any, res: any, _next: any) => {
  const msg = err?.message || String(err);
  log("error", msg, "api");
  if (res.headersSent) return;
  res.status(err?.status || 500).json({ error: msg });
});

app.listen(PORT, "0.0.0.0", () => {
  const fbStatus = firebaseStatus();
  console.log(`
🚀 AI Agent Pro v2.52.0-firebase → http://0.0.0.0:${PORT}`);
  console.log(`   Engine: Pure JS + Firebase | Phases 1–48 | GET /api/health`);
  console.log(`   Firebase: ${fbStatus.ok ? "OK · " + fbStatus.projectId : "FAIL · " + (fbStatus.error || "unknown")}`);
  console.log(`   SMTP: ${process.env.SMTP_USER ? "configured · " + process.env.SMTP_USER : "not set"}
`);
});
