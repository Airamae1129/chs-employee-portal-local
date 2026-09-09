import { db } from "../db";

/**
 * Central audit log writer. Section 9 requires an AuditLog entry for
 * every payslip view, HR request approval, time-entry edit,
 * holiday-calendar edit, and workspace access grant — plus (Section 9,
 * Teams integration) any failed delivery to Teams. Call this instead of
 * writing to the AuditLog table directly so the shape stays consistent.
 */
export async function writeAuditLog(params: {
  userId: string | null;
  action: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}) {
  await db
    .insertInto("AuditLog")
    .values({
      userId: params.userId,
      action: params.action,
      targetId: params.targetId ?? null,
      metadata: params.metadata ?? null,
    })
    .execute();
}
