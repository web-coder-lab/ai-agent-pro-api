/**
 * Phase 23 — Connectors + Delivery
 * Email outbox, Slack webhook, generic webhook, Jira-style issue, zip+send
 */

import { log } from "./logger.js";
import { exportZip } from "./fileManager.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const DATA = join(process.cwd(), ".data");
const OUTBOX = join(DATA, "outbox");
const CONFIG = join(DATA, "connectors.json");
mkdirSync(OUTBOX, { recursive: true });

export type ConnectorConfig = {
  emailTo?: string;
  emailFrom?: string;
  slackWebhookUrl?: string;
  genericWebhookUrl?: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
  jiraProjectKey?: string;
};

function loadConfig(): ConnectorConfig {
  if (!existsSync(CONFIG)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(c: ConnectorConfig) {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(CONFIG, JSON.stringify(c, null, 2));
}

export function getConnectorConfig(): ConnectorConfig {
  return loadConfig();
}

export function setConnectorConfig(patch: ConnectorConfig): ConnectorConfig {
  const next = { ...loadConfig(), ...patch };
  saveConfig(next);
  log("info", "Connector config updated", "connectors");
  return next;
}

export type DeliveryRecord = {
  id: string;
  channel: "email" | "slack" | "webhook" | "jira" | "zip_email";
  status: "sent" | "queued" | "failed";
  to?: string;
  subject?: string;
  body?: string;
  response?: string;
  createdAt: string;
  meta?: any;
};

function saveDelivery(rec: DeliveryRecord) {
  const file = join(OUTBOX, `${rec.id}.json`);
  writeFileSync(file, JSON.stringify(rec, null, 2));
  // also append body as .txt for email
  if (rec.channel === "email" || rec.channel === "zip_email") {
    writeFileSync(
      join(OUTBOX, `${rec.id}.eml.txt`),
      `To: ${rec.to}\nSubject: ${rec.subject}\nDate: ${rec.createdAt}\n\n${rec.body || ""}\n`
    );
  }
}

export function listDeliveries(limit = 50): DeliveryRecord[] {
  if (!existsSync(OUTBOX)) return [];
  return readdirSync(OUTBOX)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(OUTBOX, f), "utf8")) as DeliveryRecord;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, limit) as DeliveryRecord[];
}

/** Queue email to outbox (always works). Optionally POST to webhook if configured as mail gateway. */
export async function sendEmail(opts: {
  to?: string;
  subject: string;
  body: string;
  attachZip?: boolean;
}): Promise<DeliveryRecord> {
  const cfg = loadConfig();
  const to = opts.to || cfg.emailTo || "user@localhost";
  const id = randomUUID().slice(0, 10);
  let meta: any = {};
  let status: DeliveryRecord["status"] = "queued";
  let response = "Written to outbox";

  if (opts.attachZip) {
    const zip = await exportZip(".");
    meta.zipPath = zip.zipPath;
    meta.zipSize = zip.size;
  }

  // If generic webhook is set, try to POST email payload (acts as mail gateway)
  const gateway = cfg.genericWebhookUrl;
  if (gateway) {
    try {
      const res = await fetch(gateway, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "email",
          to,
          from: cfg.emailFrom || "agent@localhost",
          subject: opts.subject,
          body: opts.body,
          meta,
        }),
      });
      response = `webhook ${res.status}: ${await res.text()}`.slice(0, 500);
      status = res.ok ? "sent" : "failed";
    } catch (e: any) {
      response = e.message;
      status = "failed";
    }
  }

  const rec: DeliveryRecord = {
    id,
    channel: opts.attachZip ? "zip_email" : "email",
    status,
    to,
    subject: opts.subject,
    body: opts.body,
    response,
    createdAt: new Date().toISOString(),
    meta,
  };
  saveDelivery(rec);
  log("info", `Email ${status} → ${to}: ${opts.subject}`, "connectors");
  return rec;
}

export async function sendSlack(text: string): Promise<DeliveryRecord> {
  const cfg = loadConfig();
  const id = randomUUID().slice(0, 10);
  const url = cfg.slackWebhookUrl;
  let status: DeliveryRecord["status"] = "failed";
  let response = "No slackWebhookUrl configured";

  if (url) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      response = `${res.status} ${await res.text()}`.slice(0, 500);
      status = res.ok ? "sent" : "failed";
    } catch (e: any) {
      response = e.message;
    }
  } else {
    // queue locally
    status = "queued";
    response = "Queued (no webhook URL)";
  }

  const rec: DeliveryRecord = {
    id,
    channel: "slack",
    status,
    body: text,
    response,
    createdAt: new Date().toISOString(),
  };
  saveDelivery(rec);
  log("info", `Slack ${status}`, "connectors");
  return rec;
}

export async function sendWebhook(payload: any): Promise<DeliveryRecord> {
  const cfg = loadConfig();
  const id = randomUUID().slice(0, 10);
  const url = cfg.genericWebhookUrl;
  let status: DeliveryRecord["status"] = "failed";
  let response = "No genericWebhookUrl configured";

  if (url) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      });
      response = `${res.status} ${await res.text()}`.slice(0, 500);
      status = res.ok ? "sent" : "failed";
    } catch (e: any) {
      response = e.message;
    }
  } else {
    status = "queued";
    response = "Queued locally (no webhook)";
  }

  const rec: DeliveryRecord = {
    id,
    channel: "webhook",
    status,
    body: JSON.stringify(payload)?.slice(0, 2000),
    response,
    createdAt: new Date().toISOString(),
  };
  saveDelivery(rec);
  return rec;
}

/** Jira-style issue create (REST). Works when jira* config present. */
export async function createJiraIssue(opts: {
  summary: string;
  description?: string;
  issueType?: string;
}): Promise<DeliveryRecord> {
  const cfg = loadConfig();
  const id = randomUUID().slice(0, 10);
  let status: DeliveryRecord["status"] = "failed";
  let response = "Jira not configured";

  if (cfg.jiraBaseUrl && cfg.jiraEmail && cfg.jiraApiToken && cfg.jiraProjectKey) {
    try {
      const auth = Buffer.from(`${cfg.jiraEmail}:${cfg.jiraApiToken}`).toString("base64");
      const res = await fetch(`${cfg.jiraBaseUrl.replace(/\/$/, "")}/rest/api/2/issue`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            project: { key: cfg.jiraProjectKey },
            summary: opts.summary,
            description: opts.description || "",
            issuetype: { name: opts.issueType || "Task" },
          },
        }),
      });
      response = `${res.status} ${await res.text()}`.slice(0, 800);
      status = res.ok ? "sent" : "failed";
    } catch (e: any) {
      response = e.message;
    }
  } else {
    status = "queued";
    response = "Queued locally (Jira config incomplete)";
  }

  const rec: DeliveryRecord = {
    id,
    channel: "jira",
    status,
    subject: opts.summary,
    body: opts.description,
    response,
    createdAt: new Date().toISOString(),
  };
  saveDelivery(rec);
  log("info", `Jira issue ${status}: ${opts.summary}`, "connectors");
  return rec;
}

/** Zip workspace and deliver via email outbox */
export async function deliverZipEmail(opts: {
  to?: string;
  subject?: string;
  message?: string;
}): Promise<DeliveryRecord> {
  return sendEmail({
    to: opts.to,
    subject: opts.subject || "AI Agent Pro — workspace export",
    body:
      opts.message ||
      "Workspace ZIP export is attached (path recorded in meta when generated).",
    attachZip: true,
  });
}
