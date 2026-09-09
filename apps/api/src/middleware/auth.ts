import { Request, Response, NextFunction } from "express";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../utils/jwt";

/** Populates req.user from the session cookie. 401s if missing/invalid/expired. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const claims = verifySessionToken(token);
  if (!claims) {
    return res.status(401).json({ error: "Session expired or invalid, please sign in again" });
  }
  req.user = claims;
  next();
}
