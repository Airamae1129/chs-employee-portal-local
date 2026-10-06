import { db } from "../db";
import { SessionClaims } from "../types";

/**
 * Whose records a caller can *view* as "team" (roles table: "View team
 * hours", "My Team page"): Admin and Payroll see everyone, Managers see
 * their direct reports (plus themselves), everyone else only themselves.
 * Read-only — never use this to decide who can approve or edit; see
 * canActFor / approvalScope for that.
 */
export async function scopedUserIds(caller: SessionClaims): Promise<string[] | "ALL"> {
  if (caller.role === "ADMIN" || caller.role === "PAYROLL") return "ALL";
  if (caller.role === "MANAGER") {
    const reports = await db.selectFrom("User").select("id").where("managerId", "=", caller.sub).execute();
    return [caller.sub, ...reports.map((r) => r.id)];
  }
  return [caller.sub];
}

/**
 * Whether the caller may approve or edit something on `targetUserId`'s
 * behalf (requests, corrections, another person's time entry). Nobody
 * acts on their own records; Admins act on anyone else's, Managers only
 * on their direct reports'. So a Manager's or Admin's own request is
 * always decided by another person.
 */
export async function canActFor(caller: SessionClaims, targetUserId: string): Promise<boolean> {
  if (targetUserId === caller.sub) return false;
  if (caller.role === "ADMIN") return true;
  if (caller.role !== "MANAGER") return false;
  const target = await db.selectFrom("User").select("managerId").where("id", "=", targetUserId).executeTakeFirst();
  return target?.managerId === caller.sub;
}

/**
 * The people whose requests the caller may decide, for listing pending
 * approvals: Admin "OTHERS" (everyone but themselves), Manager their
 * direct reports, anyone else nobody.
 */
export async function approvalScope(caller: SessionClaims): Promise<string[] | "OTHERS"> {
  if (caller.role === "ADMIN") return "OTHERS";
  if (caller.role !== "MANAGER") return [];
  const reports = await db.selectFrom("User").select("id").where("managerId", "=", caller.sub).execute();
  return reports.map((r) => r.id);
}

export const OWN_APPROVAL_MESSAGE = "You can't approve or change your own request — someone else has to.";
