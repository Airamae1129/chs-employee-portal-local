import jwt from "jsonwebtoken";
import { env } from "../env";
import { SessionClaims } from "../types";

export const SESSION_COOKIE_NAME = "chs_session";

export function issueSessionToken(
  claims: Omit<SessionClaims, "iat" | "exp">
): string {
  return jwt.sign(claims, env.jwtSecret, {
    expiresIn: `${env.sessionTtlHours}h`,
  });
}

export function verifySessionToken(token: string): SessionClaims | null {
  try {
    return jwt.verify(token, env.jwtSecret) as SessionClaims;
  } catch {
    return null;
  }
}

export function sessionCookieMaxAgeMs(): number {
  return env.sessionTtlHours * 60 * 60 * 1000;
}
