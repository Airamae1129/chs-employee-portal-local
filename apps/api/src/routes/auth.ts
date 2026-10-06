import crypto from "crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { db } from "../db";
import { env, isEntraConfigured } from "../env";
import { issueSessionToken, sessionCookieMaxAgeMs, SESSION_COOKIE_NAME, verifySessionToken } from "../utils/jwt";
import { writeAuditLog } from "../utils/audit";
import { requireAuth } from "../middleware/auth";
import { sendEmailCode, verifyEmailCode } from "../utils/emailCodes";
import { maskEmail, MailDeliveryError, MailNotConfiguredError } from "../utils/mailer";
import { generateTotpSecret, matchTotpStep, totpSetupPayload } from "../utils/totp";
import { strongPassword, STRONG_PASSWORD_MESSAGE } from "../utils/passwordPolicy";

export const authRouter = Router();

type UserRow = NonNullable<Awaited<ReturnType<typeof findUserById>>>;

function findUserById(id: string) {
  return db.selectFrom("User").selectAll().where("id", "=", id).executeTakeFirst();
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function setSessionCookie(res: import("express").Response, user: { id: string; role: any; country: any; name: string; email: string }) {
  const token = issueSessionToken({
    sub: user.id,
    role: user.role,
    country: user.country,
    name: user.name,
    email: user.email,
  });
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    // In production the web app and API are on different Render
    // subdomains, so the session cookie must be sent cross-site —
    // that requires SameSite=None, which browsers only honor when
    // Secure is also set. Local dev keeps "lax" since both run on
    // http://localhost on different ports (same-site, no HTTPS).
    sameSite: env.nodeEnv === "production" ? "none" : "lax",
    secure: env.nodeEnv === "production",
    maxAge: sessionCookieMaxAgeMs(),
    path: "/",
  });
}

function publicUser(user: UserRow) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    country: user.country,
    jobTitle: user.jobTitle,
    mustResetPassword: user.mustResetPassword,
  };
}

// ---------- Short-lived challenge tokens ----------
//
// Between "password accepted" and "second factor accepted" (and between
// "reset code accepted" and "new password saved") the browser holds a
// short-lived token instead of a session. They're signed with a key
// derived from JWT_SECRET, never the session key itself, so one can't be
// pasted into the session cookie to skip MFA.

const CHALLENGE_SECRET = crypto.createHmac("sha256", env.jwtSecret).update("chs-auth-challenge").digest();

type Challenge =
  | { kind: "mfa"; sub: string }
  // "pwv" pins the password the reset was started against, so a reset
  // token stops working as soon as it has been used once.
  | { kind: "reset"; sub: string; pwv: string };

function issueChallenge(claims: Challenge, minutes: number): string {
  return jwt.sign(claims, CHALLENGE_SECRET, { expiresIn: `${minutes}m` });
}

function readChallenge<K extends Challenge["kind"]>(token: unknown, kind: K): Extract<Challenge, { kind: K }> | null {
  if (typeof token !== "string") return null;
  try {
    const claims = jwt.verify(token, CHALLENGE_SECRET) as Challenge;
    return claims.kind === kind ? (claims as Extract<Challenge, { kind: K }>) : null;
  } catch {
    return null;
  }
}

function passwordVersion(passwordHash: string | null): string {
  return crypto.createHash("sha256").update(passwordHash ?? "").digest("hex").slice(0, 16);
}

const SAME_PASSWORD_MESSAGE = "Your new password must be different from your current password.";

async function isCurrentPassword(newPassword: string, passwordHash: string | null): Promise<boolean> {
  return !!passwordHash && (await bcrypt.compare(newPassword, passwordHash));
}

// ---------- Lockouts ----------

// Roles table test: "Ten wrong passwords: locks."
const PASSWORD_MAX_FAILURES = 10;
const PASSWORD_LOCK_MINUTES = 30;

function passwordLockedMessage(until: Date): string {
  return `Your account is locked after too many wrong passwords. Try again after ${until.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}, or reset your password with "Forgot your password?".`;
}


const MFA_MAX_FAILURES = 5;
const MFA_LOCK_MINUTES = 15;

function mfaLockedMessage(user: UserRow): string | null {
  if (user.mfaLockedUntil && new Date(user.mfaLockedUntil) > new Date()) {
    return `Too many incorrect codes. Try again after ${new Date(user.mfaLockedUntil).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}.`;
  }
  return null;
}

async function recordMfaFailure(user: UserRow) {
  const failures = user.mfaFailedCount + 1;
  const lock = failures >= MFA_MAX_FAILURES;
  await db
    .updateTable("User")
    .set({
      mfaFailedCount: lock ? 0 : failures,
      mfaLockedUntil: lock ? new Date(Date.now() + MFA_LOCK_MINUTES * 60 * 1000) : user.mfaLockedUntil,
    })
    .where("id", "=", user.id)
    .execute();
  await writeAuditLog({ userId: user.id, action: lock ? "MfaLockedOut" : "MfaCodeRejected" });
}

/** Sends an email code, mapping "email isn't set up" / "couldn't send" to a readable 503. */
async function trySendEmailCode(res: import("express").Response, user: UserRow, purpose: Parameters<typeof sendEmailCode>[1]) {
  try {
    return await sendEmailCode(user, purpose);
  } catch (e) {
    if (e instanceof MailNotConfiguredError || e instanceof MailDeliveryError) {
      res.status(503).json({ error: e.message });
      return null;
    }
    throw e;
  }
}

// ---------- Sign in ----------

/**
 * A single sign-in page for every role (Section 4.2 revised): the
 * backend authenticates on email/password, then requires a second
 * factor before issuing a session carrying the account's real role.
 *
 * Accounts without a linked authenticator app get stage "SETUP": they
 * must scan the QR code and confirm an app code before anything else —
 * email codes aren't offered until the app is set up. Accounts with an
 * app get stage "VERIFY" and may use either an app code or an emailed
 * code. Either way the browser gets a 10-minute mfaToken, not a session.
 */
authRouter.post("/login", async (req, res) => {
  if (!env.allowPasswordLogin) {
    return res.status(400).json({
      error: "Password login is disabled. Sign in with Microsoft (Entra ID SSO) instead.",
      ssoUrl: `/auth/entra/start`,
    });
  }

  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  const { email, password } = parsed.data;

  const user = await db.selectFrom("User").selectAll().where("email", "=", email.toLowerCase()).executeTakeFirst();
  if (!user || !user.passwordHash) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const lockedUntil = user.loginLockedUntil && new Date(user.loginLockedUntil) > new Date() ? new Date(user.loginLockedUntil) : null;
  if (lockedUntil) return res.status(423).json({ error: passwordLockedMessage(lockedUntil) });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const failures = user.failedLoginCount + 1;
    if (failures >= PASSWORD_MAX_FAILURES) {
      const until = new Date(Date.now() + PASSWORD_LOCK_MINUTES * 60 * 1000);
      await db.updateTable("User").set({ failedLoginCount: 0, loginLockedUntil: until }).where("id", "=", user.id).execute();
      await writeAuditLog({ userId: user.id, action: "AccountLocked", metadata: { reason: `${PASSWORD_MAX_FAILURES} wrong passwords` } });
      return res.status(423).json({ error: passwordLockedMessage(until) });
    }
    await db.updateTable("User").set({ failedLoginCount: failures }).where("id", "=", user.id).execute();
    await writeAuditLog({ userId: user.id, action: "LoginFailed", metadata: { failedAttempts: failures } });
    return res.status(401).json({ error: "Invalid email or password" });
  }
  if (user.failedLoginCount > 0 || user.loginLockedUntil) {
    await db.updateTable("User").set({ failedLoginCount: 0, loginLockedUntil: null }).where("id", "=", user.id).execute();
  }

  // Only revealed after the correct password, so it can't be used to find out
  // which email addresses belong to deactivated accounts.
  if (user.status !== "ACTIVE") {
    return res.status(403).json({ error: "Unable to access your account. Please contact your administrator." });
  }

  const locked = mfaLockedMessage(user);
  if (locked) return res.status(429).json({ error: locked });

  const enrolled = hasAuthenticator(user);

  await writeAuditLog({ userId: user.id, action: "LoginPasswordAccepted" });
  res.json({
    mfaRequired: true,
    stage: enrolled ? "VERIFY" : "SETUP",
    mfaToken: issueChallenge({ kind: "mfa", sub: user.id }, 10),
    method: "TOTP",
    totpAvailable: enrolled,
    maskedEmail: maskEmail(user.email),
    emailSent: false,
  });
});

/** MFA counts as set up only once an authenticator app is linked; email codes are a fallback after that. */
function hasAuthenticator(user: UserRow): boolean {
  return !!user.totpSecret;
}

async function userFromMfaToken(req: import("express").Request, res: import("express").Response) {
  const challenge = readChallenge(req.body?.mfaToken, "mfa");
  if (!challenge) {
    res.status(401).json({ error: "Your sign-in attempt expired. Please sign in again." });
    return null;
  }
  const user = await findUserById(challenge.sub);
  if (!user || user.status !== "ACTIVE") {
    res.status(401).json({ error: "Your sign-in attempt expired. Please sign in again." });
    return null;
  }
  const locked = mfaLockedMessage(user);
  if (locked) {
    res.status(429).json({ error: locked });
    return null;
  }
  return user;
}

/** POST /auth/mfa/email — send (or resend) a sign-in code by email. Only once an app is set up. */
authRouter.post("/mfa/email", async (req, res) => {
  const user = await userFromMfaToken(req, res);
  if (!user) return;
  if (!hasAuthenticator(user)) {
    return res.status(400).json({ error: "Set up your authenticator app first. Email codes are available after that." });
  }
  const result = await trySendEmailCode(res, user, "LOGIN_MFA");
  if (result === null) return;
  if (result === "throttled") {
    return res.status(429).json({ error: "A code was just sent. Please wait a minute before requesting another." });
  }
  res.json({ ok: true, maskedEmail: maskEmail(user.email) });
});

/** POST /auth/mfa/totp/start — first-time setup: a new authenticator secret + QR code. */
authRouter.post("/mfa/totp/start", async (req, res) => {
  const user = await userFromMfaToken(req, res);
  if (!user) return;
  if (hasAuthenticator(user)) {
    return res.status(400).json({ error: "Your authenticator app is already set up. Link a new phone from Account Security after signing in." });
  }
  const secret = generateTotpSecret();
  await db.updateTable("User").set({ totpPendingSecret: secret }).where("id", "=", user.id).execute();
  res.json(await totpSetupPayload(user.email, secret));
});

const mfaVerifySchema = z.object({
  mfaToken: z.string(),
  method: z.enum(["EMAIL", "TOTP"]),
  code: z.string().min(6).max(8),
});

/**
 * POST /auth/mfa/verify — checks the second factor and issues the session.
 * For an account still in setup, only an app code from the QR just
 * scanned is accepted, and it completes enrolment.
 */
authRouter.post("/mfa/verify", async (req, res) => {
  const parsed = mfaVerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter the 6-digit code." });
  const user = await userFromMfaToken(req, res);
  if (!user) return;
  const { method, code } = parsed.data;
  const enrolling = !hasAuthenticator(user);
  if (enrolling && method !== "TOTP") {
    return res.status(400).json({ error: "Set up your authenticator app first. Email codes are available after that." });
  }

  let ok = false;
  let totpStep: number | null = null;
  if (method === "EMAIL") {
    ok = await verifyEmailCode(user.id, "LOGIN_MFA", code);
  } else {
    const secret = enrolling ? user.totpPendingSecret : user.totpSecret;
    if (!secret) return res.status(400).json({ error: "Authenticator app isn't set up for this account." });
    totpStep = matchTotpStep(code, secret);
    ok = totpStep !== null && (user.totpLastUsedStep === null || totpStep > user.totpLastUsedStep);
  }

  if (!ok) {
    await recordMfaFailure(user);
    return res.status(401).json({ error: "That code is incorrect or has expired." });
  }

  await db
    .updateTable("User")
    .set({
      mfaFailedCount: 0,
      mfaLockedUntil: null,
      ...(totpStep !== null ? { totpLastUsedStep: totpStep } : {}),
      ...(enrolling
        ? { mfaEnrolledAt: new Date(), mfaMethod: "TOTP" as const, totpSecret: user.totpPendingSecret, totpPendingSecret: null }
        : {}),
    })
    .where("id", "=", user.id)
    .execute();

  setSessionCookie(res, user);
  await writeAuditLog({ userId: user.id, action: enrolling ? "MfaEnrolled" : "LoginSucceeded", metadata: { method } });
  res.json({ user: publicUser(user) });
});

// ---------- Account security (signed in) ----------

/** GET /auth/security — the signed-in user's MFA settings. */
authRouter.get("/security", requireAuth, async (req, res) => {
  const user = await findUserById(req.user!.sub);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({
    mfaMethod: user.mfaMethod,
    mfaEnrolledAt: user.mfaEnrolledAt,
    totpEnabled: !!user.totpSecret,
    maskedEmail: maskEmail(user.email),
  });
});

/** POST /auth/security/totp/start — begin (re)linking an authenticator app. */
authRouter.post("/security/totp/start", requireAuth, async (req, res) => {
  const user = await findUserById(req.user!.sub);
  if (!user) return res.status(404).json({ error: "User not found" });
  const secret = generateTotpSecret();
  await db.updateTable("User").set({ totpPendingSecret: secret }).where("id", "=", user.id).execute();
  res.json(await totpSetupPayload(user.email, secret));
});

/** POST /auth/security/totp/confirm — a valid app code makes it the sign-in method. */
authRouter.post("/security/totp/confirm", requireAuth, async (req, res) => {
  const code = z.string().min(6).max(8).safeParse(req.body?.code);
  if (!code.success) return res.status(400).json({ error: "Enter the 6-digit code from your app." });
  const user = await findUserById(req.user!.sub);
  if (!user?.totpPendingSecret) return res.status(400).json({ error: "Start authenticator setup first." });
  const step = matchTotpStep(code.data, user.totpPendingSecret);
  if (step === null) return res.status(400).json({ error: "That code is incorrect. Check your app and try again." });
  await db
    .updateTable("User")
    .set({ totpSecret: user.totpPendingSecret, totpPendingSecret: null, totpLastUsedStep: step, mfaMethod: "TOTP", mfaEnrolledAt: user.mfaEnrolledAt ?? new Date() })
    .where("id", "=", user.id)
    .execute();
  await writeAuditLog({ userId: user.id, action: "MfaAuthenticatorLinked" });
  res.json({ ok: true });
});

// ---------- Passwords ----------

const setPasswordSchema = z.object({ newPassword: strongPassword });

/**
 * POST /auth/set-password — first-login forced reset (Staff Accounts:
 * "enter temporary password, then must enter New Password and Confirm
 * Password"). Only for accounts still on a temporary password; everyone
 * else changes it through /auth/password/change, which needs an email code.
 */
authRouter.post("/set-password", requireAuth, async (req, res) => {
  const parsed = setPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? STRONG_PASSWORD_MESSAGE });

  const user = await findUserById(req.user!.sub);
  if (!user?.mustResetPassword) {
    return res.status(400).json({ error: "Use Change Password under Account Security instead." });
  }
  if (await isCurrentPassword(parsed.data.newPassword, user.passwordHash)) {
    return res.status(400).json({ error: SAME_PASSWORD_MESSAGE });
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await db
    .updateTable("User")
    .set({ passwordHash, mustResetPassword: false, updatedAt: new Date() })
    .where("id", "=", req.user!.sub)
    .execute();
  await writeAuditLog({ userId: req.user!.sub, action: "PasswordSetByUser" });
  res.json({ ok: true });
});

/**
 * Forgot password, step 1 — POST /auth/password/forgot { email }.
 * Always answers the same way, so it can't reveal which emails have accounts.
 */
authRouter.post("/password/forgot", async (req, res) => {
  const email = z.string().email().safeParse(req.body?.email);
  if (!email.success) return res.status(400).json({ error: "Enter a valid email address." });
  const user = await db.selectFrom("User").selectAll().where("email", "=", email.data.toLowerCase()).executeTakeFirst();
  if (user && user.status === "ACTIVE") {
    const result = await trySendEmailCode(res, user, "PASSWORD_RESET");
    if (result === null) return;
    if (result === "sent") await writeAuditLog({ userId: user.id, action: "PasswordResetRequested" });
  }
  res.json({ ok: true });
});

/**
 * Forgot password, step 2 — POST /auth/password/verify-code
 * { email, code, method? } → resetToken. The code is either the one
 * emailed by step 1 (method "EMAIL", default) or the current code from
 * the user's linked authenticator app (method "TOTP"). App codes share
 * sign-in's lockout and replay protection. Errors are the same whether
 * or not the account exists or has an app linked.
 */
authRouter.post("/password/verify-code", async (req, res) => {
  const parsed = z
    .object({ email: z.string().email(), code: z.string().min(6).max(8), method: z.enum(["EMAIL", "TOTP"]).default("EMAIL") })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your email and the 6-digit code." });
  const invalid = () => res.status(401).json({ error: "That code is incorrect or has expired." });

  const user = await db.selectFrom("User").selectAll().where("email", "=", parsed.data.email.toLowerCase()).executeTakeFirst();
  if (!user || user.status !== "ACTIVE") return invalid();

  if (parsed.data.method === "TOTP") {
    const locked = mfaLockedMessage(user);
    if (locked) return res.status(429).json({ error: locked });
    const step = user.totpSecret ? matchTotpStep(parsed.data.code, user.totpSecret) : null;
    if (step === null || (user.totpLastUsedStep !== null && step <= user.totpLastUsedStep)) {
      await recordMfaFailure(user);
      return invalid();
    }
    await db
      .updateTable("User")
      .set({ totpLastUsedStep: step, mfaFailedCount: 0, mfaLockedUntil: null })
      .where("id", "=", user.id)
      .execute();
  } else if (!(await verifyEmailCode(user.id, "PASSWORD_RESET", parsed.data.code))) {
    return invalid();
  }

  await writeAuditLog({ userId: user.id, action: "PasswordResetCodeVerified", metadata: { method: parsed.data.method } });
  res.json({ resetToken: issueChallenge({ kind: "reset", sub: user.id, pwv: passwordVersion(user.passwordHash) }, 15) });
});

/** Forgot password, step 3 — POST /auth/password/reset { resetToken, newPassword }. */
authRouter.post("/password/reset", async (req, res) => {
  const challenge = readChallenge(req.body?.resetToken, "reset");
  if (!challenge) return res.status(401).json({ error: "This reset link has expired. Please request a new code." });
  const parsed = setPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? STRONG_PASSWORD_MESSAGE });

  const user = await findUserById(challenge.sub);
  if (!user || user.status !== "ACTIVE" || passwordVersion(user.passwordHash) !== challenge.pwv) {
    return res.status(401).json({ error: "This reset link has expired. Please request a new code." });
  }
  if (await isCurrentPassword(parsed.data.newPassword, user.passwordHash)) {
    return res.status(400).json({ error: SAME_PASSWORD_MESSAGE });
  }
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await db
    .updateTable("User")
    .set({ passwordHash, mustResetPassword: false, failedLoginCount: 0, loginLockedUntil: null, updatedAt: new Date() })
    .where("id", "=", user.id)
    .execute();
  await writeAuditLog({ userId: user.id, action: "PasswordResetCompleted" });
  res.json({ ok: true });
});

/** Change password (signed in), step 1 — email a confirmation code. */
authRouter.post("/password/change/send-code", requireAuth, async (req, res) => {
  const user = await findUserById(req.user!.sub);
  if (!user) return res.status(404).json({ error: "User not found" });
  const result = await trySendEmailCode(res, user, "CHANGE_PASSWORD");
  if (result === null) return;
  if (result === "throttled") {
    return res.status(429).json({ error: "A code was just sent. Please wait a minute before requesting another." });
  }
  res.json({ ok: true, maskedEmail: maskEmail(user.email) });
});

/** Change password (signed in), step 2 — { code, newPassword }. */
authRouter.post("/password/change", requireAuth, async (req, res) => {
  const parsed = z.object({ code: z.string().min(6).max(8), newPassword: strongPassword }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Enter the code and a new password." });
  // Checked before the code, so a rejected password doesn't use up the emailed code.
  const user = await findUserById(req.user!.sub);
  if (await isCurrentPassword(parsed.data.newPassword, user?.passwordHash ?? null)) {
    return res.status(400).json({ error: SAME_PASSWORD_MESSAGE });
  }
  if (!(await verifyEmailCode(req.user!.sub, "CHANGE_PASSWORD", parsed.data.code))) {
    return res.status(401).json({ error: "That code is incorrect or has expired." });
  }
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await db
    .updateTable("User")
    .set({ passwordHash, mustResetPassword: false, updatedAt: new Date() })
    .where("id", "=", req.user!.sub)
    .execute();
  await writeAuditLog({ userId: req.user!.sub, action: "PasswordChangedByUser" });
  res.json({ ok: true });
});

authRouter.post("/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/session", (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  const claims = token ? verifySessionToken(token) : null;
  if (!claims) return res.status(401).json({ error: "Not authenticated" });
  res.json({ claims });
});

/**
 * Entra ID (Azure AD) SSO — OIDC authorization-code flow stub.
 * Fully wired for a real tenant: fill ENTRA_TENANT_ID / ENTRA_CLIENT_ID
 * / ENTRA_CLIENT_SECRET / ENTRA_REDIRECT_URI in .env, then implement
 * the two TODOs below using a library such as `openid-client` or
 * `@azure/msal-node` (ConfidentialClientApplication). Until then these
 * routes 501 so the three login pages can offer a disabled "Sign in
 * with Microsoft" button without breaking local dev, which uses
 * password login instead (see ALLOW_PASSWORD_LOGIN).
 */
authRouter.get("/entra/start", (req, res) => {
  if (!isEntraConfigured) {
    return res.status(501).json({
      error: "Entra ID SSO is not configured for this environment yet. Set ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, ENTRA_REDIRECT_URI.",
    });
  }
  // TODO: build the authorization URL, e.g. with @azure/msal-node:
  //   const msalApp = new ConfidentialClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}`, clientSecret } });
  //   const url = await msalApp.getAuthCodeUrl({ scopes: ["openid", "profile", "email"], redirectUri, state: req.query.entryPoint as string });
  //   return res.redirect(url);
  res.status(501).json({ error: "Entra ID SSO flow not yet implemented — see TODO in src/routes/auth.ts" });
});

authRouter.get("/entra/callback", (req, res) => {
  if (!isEntraConfigured) {
    return res.status(501).json({ error: "Entra ID SSO is not configured for this environment yet." });
  }
  // TODO: exchange the auth code for tokens (msalApp.acquireTokenByCode),
  // read the verified email/oid claims, upsert/match against User.entraObjectId,
  // then issue our own session JWT exactly like the password-login path above
  // (issueSessionToken + res.cookie), respecting roleSatisfiesEntryPoint using
  // the `state` param to recover which of the three entry points was used.
  res.status(501).json({ error: "Entra ID SSO flow not yet implemented — see TODO in src/routes/auth.ts" });
});
