import nodemailer from "nodemailer";
import { env } from "../env";

// Fail fast rather than leaving the browser on "Sending..." for minutes
// when the mail server can't be reached.
const transporter = env.mail.host
  ? nodemailer.createTransport({
      host: env.mail.host,
      port: env.mail.port,
      secure: env.mail.secure,
      auth: env.mail.user ? { user: env.mail.user, pass: env.mail.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    })
  : null;

export class MailNotConfiguredError extends Error {
  constructor() {
    super("Email delivery isn't configured on the server yet. Please contact your administrator.");
  }
}

export class MailDeliveryError extends Error {
  constructor() {
    super("We couldn't send the email right now. Please try again in a few minutes.");
  }
}

type Mail = { to: string; subject: string; text: string; html: string };

/**
 * Sends an email. With BREVO_API_KEY set it goes through Brevo's HTTPS
 * API — needed on hosts that block outbound SMTP ports, such as Render's
 * free plan. Otherwise it uses the SMTP_* settings. With neither, local
 * dev prints the message to the API console so codes can still be
 * tested; production refuses instead, since a code nobody receives
 * would lock everyone out silently.
 */
export async function sendMail(mail: Mail) {
  try {
    if (env.mail.brevoApiKey) return await sendViaBrevo(mail);
    if (transporter) return void (await transporter.sendMail({ from: env.mail.from, ...mail }));
  } catch (e) {
    console.error("[mail] delivery failed:", e);
    throw new MailDeliveryError();
  }
  if (env.nodeEnv === "production") throw new MailNotConfiguredError();
  console.log(`\n[mail:dev] To: ${mail.to}\n[mail:dev] Subject: ${mail.subject}\n${mail.text}\n`);
}

async function sendViaBrevo(mail: Mail) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.mail.brevoApiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: parseAddress(env.mail.from),
      to: [{ email: mail.to }],
      subject: mail.subject,
      textContent: mail.text,
      htmlContent: mail.html,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Brevo responded ${res.status}: ${await res.text()}`);
}

/** "Name <a@b.c>" → { name, email }; a bare address → { email }. */
function parseAddress(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || undefined, email: m[2].trim() } : { email: from.trim() };
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}
