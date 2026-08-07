/**
 * Phase S3 — Email sender
 * Uses nodemailer when installed; otherwise writes to .data/mail-outbox.json (dev).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { log } from "./logger.js";
import { renderTemplate, type TemplateId } from "./emailTemplates.js";

const DATA = join(process.cwd(), ".data");
const OUTBOX = join(DATA, "mail-outbox.json");
mkdirSync(DATA, { recursive: true });

export type MailConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
};

export function getMailConfig(): MailConfig | null {
  const user = process.env.SMTP_USER || process.env.GMAIL_USER || "";
  const pass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || "";
  if (!user || !pass) return null;
  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    user,
    pass,
    from: process.env.EMAIL_FROM || `AI Agent Pro <${user}>`,
    secure: process.env.SMTP_SECURE === "true",
  };
}

function pushOutbox(entry: unknown) {
  let rows: unknown[] = [];
  if (existsSync(OUTBOX)) {
    try {
      rows = JSON.parse(readFileSync(OUTBOX, "utf8"));
    } catch {
      rows = [];
    }
  }
  rows.unshift(entry);
  writeFileSync(OUTBOX, JSON.stringify(rows.slice(0, 200), null, 2));
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ ok: boolean; mode: "smtp" | "outbox"; id?: string; error?: string }> {
  const cfg = getMailConfig();
  if (!cfg) {
    const id = `outbox_${Date.now()}`;
    pushOutbox({
      id,
      at: new Date().toISOString(),
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      mode: "outbox",
    });
    log("warn", `Mail outbox (no SMTP): ${opts.to} — ${opts.subject}`, "mail");
    return { ok: true, mode: "outbox", id };
  }

  try {
    // dynamic import — works after npm i nodemailer
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    const info = await transporter.sendMail({
      from: cfg.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    log("info", `Mail sent ${opts.to} ${opts.subject}`, "mail");
    return { ok: true, mode: "smtp", id: String(info.messageId || "") };
  } catch (e: any) {
    const id = `outbox_fail_${Date.now()}`;
    pushOutbox({
      id,
      at: new Date().toISOString(),
      to: opts.to,
      subject: opts.subject,
      error: e.message,
      mode: "error_fallback",
    });
    log("error", `Mail fail ${opts.to}: ${e.message}`, "mail");
    return { ok: false, mode: "outbox", id, error: e.message };
  }
}

export async function sendTemplate(
  to: string,
  template: TemplateId,
  vars: Record<string, string> = {}
) {
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const rendered = renderTemplate(template, {
    appUrl,
    appName: process.env.APP_NAME || "AI Agent Pro",
    ...vars,
  });
  return sendMail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}

export function mailStatus() {
  const cfg = getMailConfig();
  return {
    configured: !!cfg,
    host: cfg?.host || null,
    user: cfg ? cfg.user.replace(/(.{2}).+(@.+)/, "$1***$2") : null,
    outboxFile: OUTBOX,
  };
}
