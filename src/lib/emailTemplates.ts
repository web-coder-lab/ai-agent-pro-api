/**
 * Phase S3 — Premium HTML email templates
 */

export type TemplateId =
  | "register-otp"
  | "register-confirm"
  | "forgot-password"
  | "password-changed"
  | "payment-confirm"
  | "payment-pending"
  | "payment-rejected"
  | "welcome"
  | "login-alert";

function esc(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(title: string, body: string, appName = "AI Agent Pro") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/>
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#07070a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(180deg,#07070a 0%,#0c0c12 100%);padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;border-collapse:separate;">
        <!-- brand -->
        <tr><td style="padding:0 8px 20px;text-align:center;">
          <div style="display:inline-block;background:#1a1025;border:1px solid #3b0764;border-radius:999px;padding:8px 16px;">
            <span style="font-size:12px;font-weight:700;letter-spacing:0.12em;color:#c4b5fd;">✦ ${esc(appName).toUpperCase()}</span>
          </div>
        </td></tr>
        <!-- card -->
        <tr><td>
          <table role="presentation" width="100%" style="background:#12121a;border:1px solid #27272f;border-radius:20px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,0.45);">
            <tr><td style="height:4px;background:linear-gradient(90deg,#7c3aed,#a78bfa,#22d3ee);"></td></tr>
            <tr><td style="padding:32px 28px 8px;">
              <h1 style="margin:0 0 8px;font-size:24px;line-height:1.25;color:#fafafa;font-weight:700;">${esc(title)}</h1>
            </td></tr>
            <tr><td style="padding:8px 28px 28px;font-size:15px;line-height:1.65;color:#a1a1aa;">
              ${body}
            </td></tr>
            <tr><td style="padding:0 28px 28px;">
              <div style="border-top:1px solid #27272f;padding-top:18px;font-size:12px;color:#71717a;line-height:1.5;">
                Agar yeh request aap ne nahi ki to is email ko ignore kar dein.<br/>
                © ${new Date().getFullYear()} ${esc(appName)} · Secure automated mail
              </div>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function btn(href: string, label: string) {
  return `<p style="margin:28px 0 12px;text-align:center;">
    <a href="${esc(href)}" style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:600;font-size:14px;display:inline-block;box-shadow:0 8px 24px rgba(124,58,237,0.35);">${esc(label)}</a>
  </p>`;
}

function codeBox(code: string) {
  return `<div style="margin:24px 0;text-align:center;background:#0a0a10;border:1px dashed #4c1d95;border-radius:14px;padding:20px 16px;">
    <div style="font-size:11px;letter-spacing:0.15em;color:#a78bfa;margin-bottom:8px;font-weight:600;">VERIFICATION CODE</div>
    <div style="font-size:36px;font-weight:800;letter-spacing:0.28em;color:#f5f3ff;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${esc(code)}</div>
  </div>`;
}

export function renderTemplate(
  id: TemplateId,
  vars: Record<string, string>
): { subject: string; html: string; text: string } {
  const app = vars.appName || "AI Agent Pro";
  const url = vars.appUrl || "https://ai-agent-pro-api.onrender.com";
  const name = vars.name ? ` ${esc(vars.name)}` : "";

  switch (id) {
    case "register-otp":
      return {
        subject: `${app} — verification code ${vars.code || ""}`,
        html: layout(
          "Verify your email",
          `<p style="margin:0 0 12px;color:#e4e4e7;">Assalam o Alaikum${name},</p>
           <p style="margin:0 0 8px;">Account banane ke liye yeh code use karein:</p>
           ${codeBox(vars.code || "------")}
           <p style="margin:0;">Code <strong style="color:#fafafa;">${esc(vars.expiresMinutes || "10")} minutes</strong> mein expire ho jayega.</p>`,
          app
        ),
        text: `Your verification code is ${vars.code}. Expires in ${vars.expiresMinutes || "10"} minutes.`,
      };

    case "register-confirm":
      return {
        subject: `${app} — email confirmed ✓`,
        html: layout(
          "Email confirmed",
          `<p style="margin:0 0 12px;color:#e4e4e7;">Shukriya${name}!</p>
           <p style="margin:0 0 8px;">Aapka email verify ho gaya hai. Ab aap platform ki full features use kar sakte ho.</p>
           ${btn(url, "Open dashboard")}`,
          app
        ),
        text: `Email confirmed. Open ${url}`,
      };

    case "welcome":
      return {
        subject: `Welcome to ${app} 🚀`,
        html: layout(
          "Welcome aboard",
          `<p style="margin:0 0 12px;color:#e4e4e7;">Assalam o Alaikum${name},</p>
           <p style="margin:0 0 8px;"><strong style="color:#fafafa;">${esc(app)}</strong> mein khush aamdeed.</p>
           <ul style="padding-left:18px;margin:16px 0;color:#a1a1aa;">
             <li>AI agent & workspace tools</li>
             <li>Plans & secure billing</li>
             <li>Admin-grade controls</li>
           </ul>
           ${btn(url, "Get started")}`,
          app
        ),
        text: `Welcome to ${app}. Open ${url}`,
      };

    case "forgot-password":
      return {
        subject: `${app} — reset password`,
        html: layout(
          "Reset your password",
          `<p style="margin:0 0 12px;color:#e4e4e7;">Hi${name},</p>
           <p style="margin:0 0 8px;">Password reset ke liye neeche button dabayein. Link <strong style="color:#fafafa;">${esc(vars.expiresMinutes || "30")} minutes</strong> valid hai.</p>
           ${btn(vars.resetUrl || url, "Reset password")}
           <p style="margin:16px 0 0;font-size:12px;word-break:break-all;color:#71717a;">${esc(vars.resetUrl || "")}</p>`,
          app
        ),
        text: `Reset password: ${vars.resetUrl}`,
      };

    case "password-changed":
      return {
        subject: `${app} — password updated`,
        html: layout(
          "Password updated",
          `<p style="margin:0 0 12px;color:#e4e4e7;">Hi${name},</p>
           <p style="margin:0;">Aapka password successfully change ho gaya hai. Agar yeh aap ne nahi kiya to turant support se contact karein.</p>
           ${btn(url, "Sign in")}`,
          app
        ),
        text: `Your password was changed. If this wasn't you, contact support.`,
      };

    case "login-alert":
      return {
        subject: `${app} — new sign-in`,
        html: layout(
          "New sign-in detected",
          `<p style="margin:0 0 12px;color:#e4e4e7;">Hi${name},</p>
           <p style="margin:0 0 8px;">Aapke account mein naya login hua hai.</p>
           <table role="presentation" style="width:100%;background:#0a0a10;border-radius:12px;padding:12px 14px;margin:16px 0;font-size:13px;color:#d4d4d8;">
             <tr><td style="padding:4px 0;color:#71717a;">Time</td><td style="padding:4px 0;text-align:right;">${esc(vars.time || new Date().toISOString())}</td></tr>
             <tr><td style="padding:4px 0;color:#71717a;">IP / Device</td><td style="padding:4px 0;text-align:right;">${esc(vars.device || "Unknown")}</td></tr>
           </table>
           <p style="margin:0;font-size:13px;">Agar yeh aap nahi the to password turant change karein.</p>`,
          app
        ),
        text: `New sign-in at ${vars.time || ""}. If not you, change password.`,
      };

    case "payment-pending":
      return {
        subject: `${app} — payment received (pending review)`,
        html: layout(
          "Payment under review",
          `<p style="margin:0 0 12px;color:#e4e4e7;">Hi${name},</p>
           <p style="margin:0 0 8px;">Aapki payment request mil gayi hai. Admin approve karega to plan active ho jayega.</p>
           <table role="presentation" style="width:100%;background:#0a0a10;border-radius:12px;padding:12px 14px;margin:16px 0;font-size:13px;color:#d4d4d8;">
             <tr><td style="padding:4px 0;color:#71717a;">Plan</td><td style="padding:4px 0;text-align:right;color:#c4b5fd;font-weight:600;">${esc(vars.plan || "")}</td></tr>
             <tr><td style="padding:4px 0;color:#71717a;">Amount</td><td style="padding:4px 0;text-align:right;">${esc(vars.amount || "")}</td></tr>
             <tr><td style="padding:4px 0;color:#71717a;">Txn ref</td><td style="padding:4px 0;text-align:right;">${esc(vars.ref || "")}</td></tr>
           </table>`,
          app
        ),
        text: `Payment pending review. Plan ${vars.plan}, ref ${vars.ref}`,
      };

    case "payment-confirm":
      return {
        subject: `${app} — payment approved · plan active`,
        html: layout(
          "Payment approved 🎉",
          `<p style="margin:0 0 12px;color:#e4e4e7;">Mubarak ho${name}!</p>
           <p style="margin:0 0 8px;">Aapki payment approve ho gayi. Plan ab active hai.</p>
           <table role="presentation" style="width:100%;background:#052e16;border:1px solid #166534;border-radius:12px;padding:12px 14px;margin:16px 0;font-size:13px;color:#bbf7d0;">
             <tr><td style="padding:4px 0;">Plan</td><td style="padding:4px 0;text-align:right;font-weight:700;">${esc(vars.plan || "")}</td></tr>
             <tr><td style="padding:4px 0;">Amount</td><td style="padding:4px 0;text-align:right;">${esc(vars.amount || "")}</td></tr>
             <tr><td style="padding:4px 0;">Ref</td><td style="padding:4px 0;text-align:right;">${esc(vars.ref || "")}</td></tr>
           </table>
           ${btn(url, "Open workspace")}`,
          app
        ),
        text: `Payment approved. Plan ${vars.plan} active.`,
      };

    case "payment-rejected":
      return {
        subject: `${app} — payment not approved`,
        html: layout(
          "Payment not approved",
          `<p style="margin:0 0 12px;color:#e4e4e7;">Hi${name},</p>
           <p style="margin:0 0 8px;">Aapki payment request approve nahi hui. Detail check karke dubara submit kar sakte ho.</p>
           <p style="margin:0;font-size:13px;color:#fca5a5;">Ref: ${esc(vars.ref || "—")}</p>
           ${btn(url, "Try again")}`,
          app
        ),
        text: `Payment rejected. Ref ${vars.ref}`,
      };

    default:
      return {
        subject: app,
        html: layout("Notification", `<p>${esc(JSON.stringify(vars))}</p>`, app),
        text: JSON.stringify(vars),
      };
  }
}
