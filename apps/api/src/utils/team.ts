import { db } from "../db";
import { SessionClaims } from "../types";

/**
 * Returns the set of user ids a caller is allowed to see "team" data
 * for: Admins see everyone, Managers see their direct reports (plus
 * themselves), Employees see only themselves. Used to scope
 * /time/team, /calendar/team, /hr-requests/team, /availability/team.
 */
export async function scopedUserIds(caller: SessionClaims): Promise<string[] | "ALL"> {
  if (caller.role === "ADMIN") return "ALL";
  if (caller.role === "MANAGER") {
    const reports = await db.selectFrom("User").select("id").where("managerId", "=", caller.sub).execute();
    return [caller.sub, ...reports.map((r) => r.id)];
  }
  return [caller.sub];
}
