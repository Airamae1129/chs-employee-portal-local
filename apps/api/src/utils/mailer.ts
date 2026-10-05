import nodemailer from "nodemailer";
import { env } from "../env";

const transporter = env.mail.host
  ? nodemailer.createTransport({
      host: env.mail.host,
      port: env.mail.port,
      secure: env.mail.secure,
      auth: env.mail.user ? { user: env.mail.user, pass: env.mail.pass } : undefined,
    })
  : null;

export class MailNotConfiguredError extends Error {
  constructor() {
    super("Email delivery isn't configured on the server yet. Please contact your administrator.");
  }
}

/**
 * Sends an email through SMTP_* settings. Without SMTP_HOST, local dev
 * prints the message to the API console so codes can still be tested;
 * production refuses instead, since a code nobody receives would lock
 * everyone out silently.
 */
export async function sendMail(params: { to: string; subject: string; text: string; html: string }) {
  if (!transporter) {
    if (env.nodeEnv === "production") throw new MailNotConfiguredError();
    console.log(`\n[mail:dev] To: ${params.to}\n[mail:dev] Subject: ${params.subject}\n${params.text}\n`);
    return;
  }
  await transporter.sendMail({ from: env.mail.from, ...params });
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}
