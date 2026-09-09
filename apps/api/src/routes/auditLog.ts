import { Router } from "express";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { allow } from "../middleware/rbac";

export const auditLogRouter = Router();
auditLogRouter.use(requireAuth, allow("ADMIN"));

/** GET /audit-log?action=&userId=&from=&to= — Admin only, filterable (Section 7/9). */
auditLogRouter.get("/", async (req, res) => {
  const { action, userId, from, to } = req.query as Record<string, string | undefined>;

  const entries = await db
    .selectFrom("AuditLog")
    .selectAll()
    .$if(!!action, (qb) => qb.where("action", "=", action as string))
    .$if(!!userId, (qb) => qb.where("userId", "=", userId as string))
    .$if(!!from, (qb) => qb.where("timestamp", ">=", new Date(from as string)))
    .$if(!!to, (qb) => qb.where("timestamp", "<=", new Date(to as string)))
    .orderBy("timestamp", "desc")
    .limit(500)
    .execute();

  const userIds = [...new Set(entries.map((e) => e.userId).filter((id): id is string => !!id))];
  const users = userIds.length
    ? await db.selectFrom("User").select(["id", "name", "email"]).where("id", "in", userIds).execute()
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  res.json({ entries: entries.map((e) => ({ ...e, user: e.userId ? byId.get(e.userId) ?? null : null })) });
});
