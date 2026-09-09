import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db";
import { env, isEntraConfigured } from "../env";
import { issueSessionToken, sessionCookieMaxAgeMs, SESSION_COOKIE_NAME, verifySessionToken } from "../utils/jwt";
import { writeAuditLog } from "../utils/audit";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();

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

/**
 * A single sign-in page for every role (Section 4.2 revised): the
 * backend authenticates on email/password alone and issues a session
 * carrying the account's real role. The web app then routes everyone
 * to the same /dashboard shell, whose sidebar nav is already role-
 * aware (see lib/nav.ts) — an Employee, Manager, or Admin account all
 * land in the "right" portal without picking one up front.
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
  if (!user || !user.passwordHash || user.status !== "ACTIVE") {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  setSessionCookie(res, user);
  await writeAuditLog({ userId: user.id, action: "LoginSucceeded" });

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      country: user.country,
      jobTitle: user.jobTitle,
      mustResetPassword: user.mustResetPassword,
    },
  });
});

// 8-16 chars, at least one uppercase, one lowercase, one number, one symbol.
const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,16}$/;
const STRONG_PASSWORD_MESSAGE =
  "Password must be 8-16 characters and include an uppercase letter, a lowercase letter, a number, and a symbol.";

const setPasswordSchema = z.object({
  newPassword: z.string().regex(STRONG_PASSWORD_REGEX, STRONG_PASSWORD_MESSAGE),
});

/**
 * POST /auth/set-password — first-login forced reset (Staff Accounts:
 * "enter temporary password, then must enter New Password and Confirm
 * Password"). Requires an authenticated session (the temp password
 * already got them one), so this doubles as a general change-password
 * endpoint too.
 */
authRouter.post("/set-password", requireAuth, async (req, res) => {
  const parsed = setPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? STRONG_PASSWORD_MESSAGE });

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await db
    .updateTable("User")
    .set({ passwordHash, mustResetPassword: false, updatedAt: new Date() })
    .where("id", "=", req.user!.sub)
    .execute();
  await writeAuditLog({ userId: req.user!.sub, action: "PasswordSetByUser" });
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
