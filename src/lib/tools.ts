/**
 * Phase 4 — Agent Tools Core (Hardened)
 * Validated args • Consistent results • Extra tools
 */

import { runCode, listLanguages, detectAvailableLanguages, WORKSPACE } from "./codeRunner.js";
import {
  listTree, readWorkspaceFile, writeWorkspaceFile, deleteWorkspacePath,
  createDirectory, listAllFiles, exportZip, importZip, renamePath,
} from "./fileManager.js";
import db from "../db/schema.js";
import { spawn } from "child_process";
import { log } from "./logger.js";
import { isToolAllowed, requestApproval } from "./security.js";
import { isDangerousCommand } from "./hardening.js";
import { credentialsForAgent, githubApi } from "./credentialBroker.js";
import { addEntry, searchMemory, memoryContext, getMemory } from "./workspaceMemory.js";
import { buildGraph, queryGraph, graphSummary } from "./knowledgeGraph.js";
import {
  mergeSettings, getSettings, listProfiles, applyProfile, installExtension as vsInstall,
} from "./vscodeController.js";
import { teamHandOff, activeMissionsForRole } from "./teamLoop.js";
import { listMissions, getMission, nextActions } from "./company.js";
import { openUrl, researchTopic, readTabText, listTabs } from "./browserAgent.js";
import { researchAndIngest, ingestReport, findRelatedMemory } from "./researchIngest.js";
import { listVps, execOnVps, checkVps } from "./vpsBroker.js";
import { listLocalAiNodes, monitorCluster, clusterStats } from "./localAiCluster.js";
import { detectTools, runDeployRecipe, deployStatus, generateDeployPack, detectDeployTools } from "./deployAgents.js";
import { fullStackGenerate, detectKubeTools } from "./k8sLbCdn.js";
import { createTwin, simulate, canPromote, listTwins } from "./digitalTwin.js";
import { infraStatus, createInfraSnapshot, collectMetrics } from "./infraMonitor.js";
import { scanEmergencies, listIncidents, mitigateIncident, emergencyStats } from "./emergency.js";
import { runSelfImprove, listImproveReports } from "./selfImprove.js";
import { listDecisions, recordDecision } from "./timeTravel.js";

export type ToolResult = {
  toolName: string;
  args: Record<string, any>;
  result?: any;
  error?: string;
  executionTime: number;
};

type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
};

export const TOOL_DEFINITIONS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "execute_code",
      description:
        "Run code in a sandboxed environment. Supports python, javascript, typescript, bash, php, ruby, perl, c, cpp, go, rust, java and more. Returns stdout, stderr, exitCode.",
      parameters: {
        type: "object",
        properties: {
          language: { type: "string", description: "Language id" },
          code: { type: "string", description: "Source code to execute" },
        },
        required: ["language", "code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_languages",
      description: "List all supported languages and which runtimes are available right now.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "shell_command",
      description: "Run a bash shell command inside the workspace directory. Use for ls, git, curl, etc.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Bash command" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "install_package",
      description: "Install a package. manager: pip | npm | apt (limited).",
      parameters: {
        type: "object",
        properties: {
          manager: { type: "string", enum: ["pip", "npm", "apt"] },
          package: { type: "string", description: "Package name" },
        },
        required: ["manager", "package"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file from the workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a file in the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and directories as a tree. Optional subpath.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path, default workspace root" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file or directory from the workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mkdir",
      description: "Create a directory (recursive) in the workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_info",
      description: "Get workspace root path, file count, and top-level listing.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "remember",
      description: "Save a key-value memory that persists across chats.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string" },
          value: { type: "string" },
          category: { type: "string" },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recall",
      description: "Load memory by exact key, or search, or list all.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string" },
          search: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web (DuckDuckGo). Returns abstract and related topics.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rename_file",
      description: "Rename or move a file/folder inside the workspace.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
        },
        required: ["from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "export_zip",
      description: "Export workspace (or subfolder) as a zip/tar.gz on the server. Returns path and size.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Subfolder to export, default workspace root" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tools",
      description: "List every tool the agent can use and short descriptions.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_logs",
      description: "Read recent platform logs (executions, agent events, system). Optional filter text.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number" },
          filter: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_logs",
      description: "Clear in-memory platform console logs.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_credentials",
      description: "List connected accounts (masked only). Never returns raw secrets.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "github_api",
      description: "Call GitHub API via vault credential. Path e.g. /user or /user/repos. Token never exposed to you.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          method: { type: "string" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recall_memory",
      description: "Search workspace permanent memory (architecture, APIs, bugs, tasks, notes).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          section: { type: "string", description: "architecture|apis|coding_style|pending_tasks|bugs|team_notes|decisions|custom" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_project",
      description: "Save a fact into permanent workspace memory.",
      parameters: {
        type: "object",
        properties: {
          section: { type: "string" },
          title: { type: "string" },
          content: { type: "string" },
        },
        required: ["title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "build_knowledge_graph",
      description: "Scan workspace and rebuild knowledge graph (files, imports, APIs, packages).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "query_graph",
      description: "Query knowledge graph. Filter by type (file|api|module|package|db), text q, or around a node.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string" },
          q: { type: "string" },
          around: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vscode_merge_settings",
      description: "Merge keys into workspace .vscode/settings.json (formatOnSave, theme, formatter, etc.)",
      parameters: {
        type: "object",
        properties: {
          patch: { type: "object", description: "Settings keys to merge" },
        },
        required: ["patch"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vscode_apply_profile",
      description: "Apply a VS Code profile: web-prettier | python-black | minimal",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_missions",
      description: "List company missions and their status.",
      parameters: { type: "object", properties: { status: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "mission_handoff",
      description: "Advance a mission in the team loop (assign, submit_owner, owner_approve, lead_approve, admin_approve, etc.)",
      parameters: {
        type: "object",
        properties: {
          missionId: { type: "string" },
          action: { type: "string" },
          note: { type: "string" },
        },
        required: ["missionId", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_open",
      description: "Open a public http(s) URL and extract readable text.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_research",
      description: "Research a topic across multiple sources and write a markdown report.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string" },
          urls: { type: "array", items: { type: "string" } },
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "research_and_ingest",
      description: "Research a topic, write report, and ingest into workspace memory + knowledge graph.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string" },
          urls: { type: "array", items: { type: "string" } },
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ingest_research_report",
      description: "Ingest an existing research report id into memory and knowledge graph.",
      parameters: {
        type: "object",
        properties: { reportId: { type: "string" } },
        required: ["reportId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_vps",
      description: "List registered VPS targets (no secrets).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "vps_exec",
      description: "Run a safe command on a registered VPS via SSH (key from vault).",
      parameters: {
        type: "object",
        properties: {
          vpsId: { type: "string" },
          command: { type: "string" },
        },
        required: ["vpsId", "command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_ai_status",
      description: "List distributed local AI nodes and cluster stats (Head monitor view).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "deploy_pack",
      description: "Generate Dockerfile, compose, PM2, nginx, Caddy configs in workspace.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", description: "node|static|python" },
          port: { type: "number" },
          domain: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "deploy_status",
      description: "Detect docker/pm2/nginx/caddy availability and recent deploy logs.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "deploy_status",
      description: "Detect docker/pm2/nginx tools and recent deploy actions.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "deploy_recipe",
      description: "Run deploy recipe: node-docker | node-pm2 | static-nginx. Generates configs; builds only if tools exist.",
      parameters: {
        type: "object",
        properties: {
          recipe: { type: "string" },
          domain: { type: "string" },
          port: { type: "number" },
          vpsId: { type: "string" },
        },
        required: ["recipe"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "k8s_generate",
      description: "Generate Kubernetes manifests, LB config, and CDN setup hints into workspace deploy/.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          image: { type: "string" },
          port: { type: "number" },
          domain: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_twin",
      description: "Create a digital twin snapshot of current workspace/deploy inventory.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" }, vpsId: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "simulate_twin",
      description: "Run simulation checks on a twin. Promote only if promoteReady.",
      parameters: {
        type: "object",
        properties: { twinId: { type: "string" } },
        required: ["twinId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "infra_status",
      description: "Host CPU/memory/disk metrics, alerts, and snapshot list.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "infra_snapshot",
      description: "Create workspace infrastructure snapshot (tar backup).",
      parameters: {
        type: "object",
        properties: { label: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "emergency_scan",
      description: "Scan metrics/health/logs for incidents and open emergency tickets.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "self_improve",
      description: "Scan workspace for improvement opportunities (large files, duplication, TODOs, complexity). Returns proposals only — does not auto-edit.",
      parameters: { type: "object", properties: { maxFiles: { type: "number" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "time_travel_list",
      description: "List recent decisions for audit/rollback.",
      parameters: { type: "object", properties: {} },
    },
  },

];

function requireString(args: Record<string, any>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !v.trim()) throw new Error(`Missing or invalid argument: ${key}`);
  return v;
}

function runInstall(manager: string, pkg: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cmds: Record<string, string[]> = {
    pip: ["pip3", "install", "--user", pkg],
    npm: ["npm", "install", pkg],
    apt: ["apt-get", "install", "-y", pkg],
  };
  const cmd = cmds[manager];
  if (!cmd) return Promise.resolve({ stdout: "", stderr: `Unknown manager: ${manager}`, exitCode: 1 });

  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: WORKSPACE,
      env: { ...process.env, PYTHONUSERBASE: WORKSPACE + "/.python" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ stdout, stderr: stderr + "\n[timeout]", exitCode: 124 });
    }, 60000);
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ stdout: stdout.slice(0, 5000), stderr: stderr.slice(0, 5000), exitCode: code ?? 1 });
    });
    child.on("error", (err) => {
      clearTimeout(t);
      resolve({ stdout: "", stderr: err.message, exitCode: 1 });
    });
  });
}

export async function dispatchTool(name: string, args: Record<string, any> = {}): Promise<ToolResult> {
  const start = Date.now();
  try {
    const gate = isToolAllowed(name);
    if (!gate.ok) {
      return { toolName: name, args, error: gate.reason || "Not allowed", executionTime: 0 };
    }
    if (gate.needsApproval) {
      const a = requestApproval(name, args);
      return {
        toolName: name,
        args,
        error: `Approval required (${a.id}). Approve via Admin → Approvals.`,
        executionTime: 0,
      };
    }

    let result: any;

    switch (name) {
      case "execute_code": {
        const language = requireString(args, "language");
        const code = requireString(args, "code");
        result = await runCode(language, code);
        log("exec", `tool execute_code ${language}`, "tools");
        db.addExecutionLog({
          language: result.language,
          code,
          output: result.stdout,
          error_output: result.stderr,
          exit_code: result.exitCode,
          execution_time: result.executionTime,
        });
        break;
      }

      case "list_languages": {
        const all = listLanguages();
        const available = await detectAvailableLanguages();
        result = {
          total: all.length,
          available: available.map((l) => l.id),
          languages: all,
        };
        break;
      }

      case "shell_command": {
        const command = requireString(args, "command");
        if (isDangerousCommand(command)) {
          throw new Error("Command blocked for safety — use workspace file tools instead of destructive shell");
        }
        result = await runCode("bash", command);
        break;
      }

      case "install_package": {
        const manager = requireString(args, "manager");
        const pkg = requireString(args, "package");
        if (!["pip", "npm", "apt"].includes(manager)) throw new Error("manager must be pip|npm|apt");
        result = await runInstall(manager, pkg);
        break;
      }

      case "read_file":
        result = await readWorkspaceFile(requireString(args, "path"));
        break;

      case "write_file":
        result = await writeWorkspaceFile(requireString(args, "path"), args.content ?? "");
        log("info", `write ${args.path}`, "tools");
        break;

      case "list_files":
        result = await listTree(args.path || ".");
        break;

      case "delete_file":
        result = await deleteWorkspacePath(requireString(args, "path"));
        // Note: Phase 52 will route deletes into workspace/.trash
        break;

      case "mkdir":
        result = await createDirectory(requireString(args, "path"));
        break;

      case "deploy_pack":
        result = await generateDeployPack({
          serviceName: args.serviceName ? String(args.serviceName) : (args.type ? String(args.type) : undefined),
          port: args.port ? Number(args.port) : undefined,
          domain: args.domain ? String(args.domain) : undefined,
          nodeVersion: args.nodeVersion ? String(args.nodeVersion) : undefined,
        });
        break;
      case "time_travel_list":
        result = { decisions: listDecisions(30) };
        break;
      case "self_improve":
        result = await runSelfImprove({ maxFiles: args.maxFiles ? Number(args.maxFiles) : 150 });
        break;
      case "emergency_scan":
        result = await scanEmergencies();
        break;
      case "infra_status":
        result = await infraStatus();
        break;
      case "infra_snapshot":
        result = await createInfraSnapshot(args.label ? String(args.label) : undefined);
        break;
      case "create_twin":
        result = await createTwin({ name: args.name, vpsId: args.vpsId });
        break;
      case "simulate_twin": {
        const sim = await simulate(requireString(args, "twinId"));
        result = { ...sim, promote: canPromote(String(args.twinId)) };
        break;
      }
      case "k8s_generate":
        result = await fullStackGenerate({
          name: args.name,
          image: args.image,
          port: args.port ? Number(args.port) : undefined,
          domain: args.domain,
        });
        break;
      case "deploy_status":
        result = await deployStatus();
        break;
      case "time_travel_list":
        result = { decisions: listDecisions(30) };
        break;
      case "self_improve":
        result = await runSelfImprove({ maxFiles: args.maxFiles ? Number(args.maxFiles) : 150 });
        break;
      case "emergency_scan":
        result = await scanEmergencies();
        break;
      case "infra_status":
        result = await infraStatus();
        break;
      case "infra_snapshot":
        result = await createInfraSnapshot(args.label ? String(args.label) : undefined);
        break;
      case "create_twin":
        result = await createTwin({ name: args.name, vpsId: args.vpsId });
        break;
      case "simulate_twin": {
        const sim = await simulate(requireString(args, "twinId"));
        result = { ...sim, promote: canPromote(String(args.twinId)) };
        break;
      }
      case "k8s_generate":
        result = await fullStackGenerate({
          name: args.name,
          image: args.image,
          port: args.port ? Number(args.port) : undefined,
          domain: args.domain,
        });
        break;
      case "deploy_status":
        result = await deployStatus();
        break;
      case "deploy_recipe":
        result = await runDeployRecipe(requireString(args, "recipe") as any, {
          domain: args.domain,
          port: args.port ? Number(args.port) : undefined,
          vpsId: args.vpsId,
        });
        break;
      case "local_ai_status":
        result = { nodes: listLocalAiNodes(), stats: clusterStats() };
        break;
      case "list_vps":
        result = { targets: listVps() };
        break;
      case "vps_exec":
        result = await execOnVps(requireString(args, "vpsId"), requireString(args, "command"));
        break;
      case "research_and_ingest":
        result = await researchAndIngest(requireString(args, "topic"), args.urls);
        break;
      case "ingest_research_report":
        result = ingestReport(requireString(args, "reportId"));
        break;
      case "browser_open": {
        const tab = await openUrl(requireString(args, "url"));
        result = { ...tab, text: readTabText(tab.id, 12000) };
        break;
      }
      case "browser_research":
        result = await researchTopic(requireString(args, "topic"), args.urls);
        break;
      case "list_missions":
        result = {
          missions: listMissions(args.status).map((m) => ({
            id: m.id,
            title: m.title,
            status: m.status,
            goal: m.goal,
            next: nextActions(m.status),
          })),
        };
        break;
      case "mission_handoff":
        result = teamHandOff(
          requireString(args, "missionId"),
          requireString(args, "action"),
          "agent",
          args.note ? String(args.note) : undefined
        );
        break;
      case "vscode_merge_settings":
        result = await mergeSettings(args.patch || args);
        break;
      case "vscode_apply_profile":
        result = await applyProfile(requireString(args, "name"));
        break;
      case "build_knowledge_graph":
        result = await buildGraph().then((g) => ({ stats: g.stats, nodes: g.nodes.length, edges: g.edges.length }));
        break;
      case "query_graph":
        result = queryGraph({
          type: args.type,
          q: args.q ? String(args.q) : undefined,
          around: args.around ? String(args.around) : undefined,
        });
        break;
      case "recall_memory":
        result = {
          results: searchMemory("default", String(args.query || ""), args.section),
          contextPreview: memoryContext("default", 1500),
        };
        break;
      case "remember_project":
        result = addEntry("default", {
          section: (args.section as any) || "team_notes",
          title: requireString(args, "title"),
          content: requireString(args, "content"),
        });
        break;
      case "list_credentials":
        result = { credentials: credentialsForAgent() };
        break;
      case "github_api":
        result = await githubApi(requireString(args, "path"), {
          method: args.method,
          body: args.body,
        });
        break;
      case "workspace_info": {
        const files = await listAllFiles(".");
        const tree = await listTree(".", 2);
        result = {
          workspace: WORKSPACE,
          fileCount: files.length,
          topLevel: tree.map((n) => ({ name: n.name, type: n.type })),
        };
        break;
      }

      case "remember":
        db.setMemory(requireString(args, "key"), requireString(args, "value"), args.category);
        result = { ok: true, key: args.key };
        break;

      case "recall":
        if (args.key) result = db.getMemory(String(args.key));
        else if (args.search) result = db.searchMemory(String(args.search));
        else result = db.listMemory();
        break;

      case "web_search": {
        const query = requireString(args, "query");
        try {
          const q = encodeURIComponent(query);
          const res = await fetch(
            `https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`
          );
          const data = (await res.json()) as any;
          result = {
            query,
            abstract: data.AbstractText || data.Abstract || "",
            heading: data.Heading || "",
            related: (data.RelatedTopics || [])
              .slice(0, 5)
              .map((t: any) => t.Text || t.FirstURL)
              .filter(Boolean),
          };
        } catch (e: any) {
          result = { query, error: e.message };
        }
        break;
      }

      case "rename_file":
        result = await renamePath(requireString(args, "from"), requireString(args, "to"));
        break;

      case "export_zip":
        result = await exportZip(args.path || ".");
        break;

      case "list_tools":
        result = TOOL_DEFINITIONS.map((x) => ({
          name: x.function.name,
          description: x.function.description,
        }));
        break;

      case "get_logs": {
        const { getLogs } = await import("./logger.js");
        result = getLogs({
          limit: Number(args.limit) || 100,
          filter: args.filter ? String(args.filter) : undefined,
        });
        break;
      }

      case "clear_logs": {
        const { clearLogs } = await import("./logger.js");
        clearLogs();
        result = { ok: true };
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      toolName: name,
      args,
      result,
      executionTime: Date.now() - start,
    };
  } catch (err: any) {
    return {
      toolName: name,
      args,
      error: err.message || String(err),
      executionTime: Date.now() - start,
    };
  }
}

export function listToolNames(): string[] {
  return TOOL_DEFINITIONS.map((t) => t.function.name);
}
