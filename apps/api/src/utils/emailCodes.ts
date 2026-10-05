import crypto from "crypto";
import { db } from "../db";
import { env } from "../env";
import { sendMail } from "./mailer";

export type EmailCodePurpose = "PASSWORD_RESET" | "LOGIN_MFA" | "CHANGE_PASSWORD";

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

const COPY: Record<EmailCodePurpose, { subject: string; intro: string }> = {
  LOGIN_MFA: { subject: "Your CHS sign-in code", intro: "Use this code to finish signing in to the CHS Employee Portal." },
  PASSWORD_RESET: { subject: "Your CHS password reset code", intro: "Use this code to reset your CHS Employee Portal password." },
  CHANGE_PASSWORD: { subject: "Your CHS password change code", intro: "Use this code to confirm your CHS Employee Portal password change." },
};

function hashCode(code: string): string {
  return crypto.createHmac("sha256", env.jwtSecret).update(code).digest("hex");
}

/**
 * Emails a fresh 6-digit code, invalidating any earlier unused code for the
 * same purpose. Returns "throttled" without sending if one went out in the
 * last minute, so the endpoint can't be used to flood an inbox.
 */
export async function sendEmailCode(
  user: { id: string; email: string; name: string },
  purpose: EmailCodePurpose
): Promise<"sent" | "throttled"> {
  const latest = await db
    .selectFrom("EmailCode")
    .select("createdAt")
    .where("userId", "=", user.id)
    .where("purpose", "=", purpose)
    .orderBy("createdAt", "desc")
    .executeTakeFirst();
  if (latest && Date.now() - new Date(latest.createdAt).getTime() < RESEND_COOLDOWN_SECONDS * 1000) {
    return "throttled";
  }

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  await db
    .updateTable("EmailCode")
    .set({ consumedAt: new Date() })
    .where("userId", "=", user.id)
    .where("purpose", "=", purpose)
    .where("consumedAt", "is", null)
    .execute();
  await db
    .insertInto("EmailCode")
    .values({
      userId: user.id,
      purpose,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
    })
    .execute();

  const { subject, intro } = COPY[purpose];
  await sendMail({
    to: user.email,
    subject,
    text: `Hi ${user.name},\n\n${intro}\n\nCode: ${code}\n\nIt expires in ${CODE_TTL_MINUTES} minutes. If you didn't request this, you can ignore this email and consider changing your password.`,
    html: `<div style="font-family:Arial,sans-serif;color:#1f1f1f;max-width:480px">
  <p>Hi ${escapeHtml(user.name)},</p>
  <p>${intro}</p>
  <p style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:24px 0">${code}</p>
  <p style="color:#666;font-size:13px">It expires in ${CODE_TTL_MINUTES} minutes. If you didn't request this, you can ignore this email and consider changing your password.</p>
</div>`,
  });
  return "sent";
}

/** Checks a code against the latest live one; each code allows 5 tries and works once. */
export async function verifyEmailCode(userId: string, purpose: EmailCodePurpose, code: string): Promise<boolean> {
  const row = await db
    .selectFrom("EmailCode")
    .selectAll()
    .where("userId", "=", userId)
    .where("purpose", "=", purpose)
    .where("consumedAt", "is", null)
    .where("expiresAt", ">", new Date())
    .orderBy("createdAt", "desc")
    .executeTakeFirst();
  if (!row || row.attempts >= MAX_ATTEMPTS) return false;

  const expected = Buffer.from(row.codeHash, "hex");
  const actual = Buffer.from(hashCode(code.trim()), "hex");
  if (!crypto.timingSafeEqual(expected, actual)) {
    await db.updateTable("EmailCode").set({ attempts: row.attempts + 1 }).where("id", "=", row.id).execute();
    return false;
  }
  await db.updateTable("EmailCode").set({ consumedAt: new Date() }).where("id", "=", row.id).execute();
  return true;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
