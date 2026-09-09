import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { allow } from "../middleware/rbac";
import { writeAuditLog } from "../utils/audit";

/** Dashboard "Notification from Admin/Manager" feed. */
export const announcementsRouter = Router();
announcementsRouter.use(requireAuth);

announcementsRouter.get("/", async (_req, res) => {
  const announcements = await db
    .selectFrom("Announcement")
    .selectAll()
    .orderBy("createdAt", "desc")
    .limit(20)
    .execute();
  const authorIds = [...new Set(announcements.map((a) => a.authorId))];
  const authors = authorIds.length
    ? await db.selectFrom("User").select(["id", "name", "role"]).where("id", "in", authorIds).execute()
    : [];
  const byId = new Map(authors.map((a) => [a.id, a]));
  res.json({ announcements: announcements.map((a) => ({ ...a, author: byId.get(a.authorId) ?? null })) });
});

const createSchema = z.object({ message: z.string().min(1).max(2000) });

announcementsRouter.post("/", allow("MANAGER", "ADMIN"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "message is required" });
  const announcement = await db
    .insertInto("Announcement")
    .values({ authorId: req.user!.sub, message: parsed.data.message })
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ userId: req.user!.sub, action: "AnnouncementPosted", targetId: announcement.id });
  res.status(201).json({ announcement });
});

announcementsRouter.delete("/:id", allow("MANAGER", "ADMIN"), async (req, res) => {
  await db.deleteFrom("Announcement").where("id", "=", req.params.id).execute();
  await writeAuditLog({ userId: req.user!.sub, action: "AnnouncementDeleted", targetId: req.params.id });
  res.json({ ok: true });
});
