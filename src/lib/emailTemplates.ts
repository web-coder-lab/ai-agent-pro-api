/**
 * Phase S3 — HTML email templates
 */

export type TemplateId =
  | "register-otp"
  | "register-confirm"
  | "forgot-password"
  | "password-changed"
  | "payment-confirm"
  | "welcome";

function layout(title: string, body: string) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0b;font-family:Inter,Segoe UI,Arial,sans-serif;color:#fafafa;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#121214;border:1px solid #27272a;border-radius:16px;padding:28px 24px;">
        <tr><td>
          <div style="font-size:13px;color:#a78bfa;font-weight:600;letter-spacing:.04em;margin-bottom:8px;">AI AGENT PRO</div>
          <h1 style="margin:0 0 16px;font-size:22px;color:#fafafa;">${title}</h1>
          <div style="font-size:15px;line-height:1.55;color:#d4d4d8;">${body}</div>
          <p style="margin:28px 0 0;font-size:12px;color:#71717a;">If you did not request this, you can ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function renderTemplate(
  id: TemplateId,
  vars: Record<string, string>
): { subject: string; html: string; text: string } {
  const app = vars.appName || "AI Agent Pro";
  const url = vars.appUrl || "http://localhost:3000";

  switch (id) {
    case "register-otp":
      return {
        subject: `${app} — verification code`,
        html: layout(
          "Verify your email",
          `<p>Hi${vars.name ? ` ${vars.name}` : ""},</p>
           <p>Your verification code is:</p>
           <p style="font-size:32px;font-weight:700;letter-spacing:0.2em;color:#a78bfa;margin:20px 0;">${vars.code}</p>
           <p>This code expires in <strong>${vars.expiresMinutes || "10"} minutes</strong>.</p>`
        ),
        text: `Your verification code is ${vars.code}. Expires in ${vars.expiresMinutes || "10"} minutes.`,
      };
    case "register-confirm":
      return {
        subject: `${app} — email confirmed`,
        html: layout(
          "Email confirmed",
          `<p>Hi${vars.name ? ` ${vars.name}` : ""},</p>
           <p>Your email is verified. You can use the full platform now.</p>
           <p><a href="${url}" style="color:#a78bfa;">Open dashboard</a></p>`
        ),
        text: `Email confirmed. Open ${url}`,
      };
    case "forgot-password":
      return {
        subject: `${app} — reset password`,
        html: layout(
          "Reset your password",
          `<p>Hi${vars.name ? ` ${vars.name}` : ""},</p>
           <p>Click the button below to reset your password. Link expires in ${vars.expiresMinutes || "30"} minutes.</p>
           <p style="margin:24px 0;"><a href="${vars.resetUrl}" style="background:#7c3aed;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;display:inline-block;">Reset password</a></p>
           <p style="font-size:12px;color:#71717a;">Or copy: ${vars.resetUrl}</p>`
        ),
        text: `Reset password: ${vars.resetUrl}`,
      };
    case "password-changed":
      return {
        subject: `${app} — password changed`,
        html: layout(
          "Password changed",
          `<p>Hi${vars.name ? ` ${vars.name}` : ""},</p>
           <p>Your password was changed successfully. If this was not you, reset it immediately and contact support.</p>`
        ),
        text: "Your password was changed.",
      };
    case "payment-confirm":
      return {
        subject: `${app} — payment confirmed (${vars.plan || "plan"})`,
        html: layout(
          "Payment confirmed",
          `<p>Hi${vars.name ? ` ${vars.name}` : ""},</p>
           <p>We received your payment.</p>
           <ul>
             <li>Plan: <strong>${vars.plan || "—"}</strong></li>
             <li>Amount: <strong>${vars.amount || "—"}</strong></li>
             <li>Ref: <strong>${vars.ref || "—"}</strong></li>
           </ul>
           <p>Your plan is now active.</p>`
        ),
        text: `Payment confirmed for plan ${vars.plan}. Ref ${vars.ref}`,
      };
    case "welcome":
      return {
        subject: `Welcome to ${app}`,
        html: layout(
          `Welcome${vars.name ? `, ${vars.name}` : ""}`,
          `<p>Your account is ready on the free plan.</p>
           <p><a href="${url}" style="color:#a78bfa;">Go to app</a></p>`
        ),
        text: `Welcome to ${app}. Open ${url}`,
      };
    default:
      return {
        subject: app,
        html: layout("Notification", `<p>${vars.message || ""}</p>`),
        text: vars.message || "",
      };
  }
}
