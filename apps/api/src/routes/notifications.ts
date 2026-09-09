import { Router } from "express";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { allow } from "../middleware/rbac";
import { scopedUserIds } from "../utils/team";
import { runMissingClockOutNotificationSweep } from "../utils/scheduler";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

/** GET /notifications/me — own notifications (any role). */
notificationsRouter.get("/me", async (req, res) => {
  const notifications = await db
    .selectFrom("Notification")
    .selectAll()
    .where("userId", "=", req.user!.sub)
    .orderBy("createdAt", "desc")
    .limit(20)
    .execute();
  res.json({ notifications });
});

notificationsRouter.patch("/:id/read", async (req, res) => {
  await db
    .updateTable("Notification")
    .set({ readAt: new Date() })
    .where("id", "=", req.params.id)
    .where("userId", "=", req.user!.sub)
    .execute();
  res.json({ ok: true });
});

/**
 * GET /notifications/team-log — Manager/Admin visibility into the
 * automatic weekly missing-clock-out notifications sent to their team
 * (Timekeeping revision: Managers no longer edit entries directly, but
 * "have access to notify each employee" via this automatic log).
 */
notificationsRouter.get("/team-log", allow("MANAGER", "ADMIN"), async (req, res) => {
  const scope = await scopedUserIds(req.user!);
  let query = db.selectFrom("Notification").selectAll().where("type", "=", "MISSING_CLOCK_OUT");
  if (scope !== "ALL") query = query.where("userId", "in", scope);
  const notifications = await query.orderBy("createdAt", "desc").limit(50).execute();

  const userIds = [...new Set(notifications.map((n) => n.userId))];
  const users = userIds.length ? await db.selectFrom("User").select(["id", "name"]).where("id", "in", userIds).execute() : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  res.json({ notifications: notifications.map((n) => ({ ...n, user: byId.get(n.userId) ?? null })) });
});

/** POST /notifications/team-log/run-now — Admin: trigger the weekly sweep on demand (e.g. for testing). */
notificationsRouter.post("/team-log/run-now", allow("ADMIN"), async (_req, res) => {
  await runMissingClockOutNotificationSweep();
  res.json({ ok: true });
});
