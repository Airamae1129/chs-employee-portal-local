import { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../utils/jwt";

/**
 * Populates req.user from the session cookie. 401s if missing/invalid/expired.
 *
 * The account is re-read on every request, so deactivating someone or
 * changing their role takes effect immediately rather than when their
 * 12-hour session expires; the role used for every permission check is
 * the one in the database, never the one baked into the cookie.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const claims = verifySessionToken(token);
  if (!claims) {
    return res.status(401).json({ error: "Session expired or invalid, please sign in again" });
  }
  const user = await db
    .selectFrom("User")
    .select(["role", "status", "name", "email", "country"])
    .where("id", "=", claims.sub)
    .executeTakeFirst();
  if (!user || user.status !== "ACTIVE") {
    return res.status(401).json({ error: "Your account is no longer active. Please contact your administrator." });
  }
  req.user = { ...claims, role: user.role, name: user.name, email: user.email, country: user.country };
  next();
}
