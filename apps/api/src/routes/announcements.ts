import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { writeAuditLog } from "../utils/audit";
import { runAutoAnnouncementSweepThrottled } from "../utils/autoAnnouncements";
import { IE_TIME_ZONE, isoDateInZone } from "../utils/time";

/** Dashboard announcements feed — every role can post, reply and @mention. */
export const announcementsRouter = Router();
announcementsRouter.use(requireAuth);

announcementsRouter.get("/", async (_req, res) => {
  // Make sure today's automatic birthday/holiday posts exist (covers a just-woken server).
  await runAutoAnnouncementSweepThrottled();

  const now = new Date();
  const userPosts = await db
    .selectFrom("Announcement")
    .selectAll()
    .where("parentId", "is", null)
    .where("kind", "is", null)
    .orderBy("createdAt", "desc")
    .limit(20)
    .execute();

  // Automatic birthday/holiday notes only live for their own day (in the
  // note's country time zone). Dismissed ones are hidden, not deleted, so
  // the sweep can't re-post them.
  const recentAuto = await db
    .selectFrom("Announcement")
    .selectAll()
    .where("parentId", "is", null)
    .where("kind", "is not", null)
    .where("kind", "not like", "DISMISSED:%")
    .where("activeDate", ">=", isoDateInZone(new Date(now.getTime() - 2 * 86_400_000), "UTC"))
    .execute();
  const todaysAuto = recentAuto.filter((a) => a.activeDate === isoDateInZone(now, a.activeZone ?? IE_TIME_ZONE));

  const posts = [...todaysAuto, ...userPosts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const replies = posts.length
    ? await db
        .selectFrom("Announcement")
        .selectAll()
        .where("parentId", "in", posts.map((p) => p.id))
        .orderBy("createdAt", "asc")
        .execute()
    : [];

  const authorIds = [...new Set([...posts, ...replies].map((a) => a.authorId).filter((id): id is string => !!id))];
  const authors = authorIds.length
    ? await db.selectFrom("User").select(["id", "name", "role"]).where("id", "in", authorIds).execute()
    : [];
  const byId = new Map(authors.map((a) => [a.id, a]));
  const withAuthor = <T extends { authorId: string | null }>(a: T) => ({ ...a, author: a.authorId ? byId.get(a.authorId) ?? null : null });

  res.json({
    announcements: posts.map((p) => ({
      ...withAuthor(p),
      replies: replies.filter((r) => r.parentId === p.id).map(withAuthor),
    })),
  });
});

/** Everyone the current user can @mention (all active staff, any role). */
announcementsRouter.get("/mentionable", async (_req, res) => {
  const users = await db
    .selectFrom("User")
    .select(["id", "name", "role"])
    .where("status", "=", "ACTIVE")
    .orderBy("name", "asc")
    .execute();
  res.json({ users });
});

const createSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  parentId: z.string().uuid().optional(),
});

announcementsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "message is required" });

  let parentId: string | null = null;
  if (parsed.data.parentId) {
    const parent = await db.selectFrom("Announcement").select(["id", "parentId"]).where("id", "=", parsed.data.parentId).executeTakeFirst();
    if (!parent) return res.status(404).json({ error: "The announcement you're replying to no longer exists" });
    // Replies stay one level deep: replying to a reply attaches to the original post.
    parentId = parent.parentId ?? parent.id;
  }

  const announcement = await db
    .insertInto("Announcement")
    .values({ authorId: req.user!.sub, message: parsed.data.message, parentId })
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({
    userId: req.user!.sub,
    action: parentId ? "AnnouncementReplied" : "AnnouncementPosted",
    targetId: announcement.id,
  });
  res.status(201).json({ announcement });
});

/** Authors can delete their own posts/replies; Managers and Admins can moderate any. */
announcementsRouter.delete("/:id", async (req, res) => {
  const existing = await db.selectFrom("Announcement").select(["id", "authorId", "kind"]).where("id", "=", req.params.id).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "Announcement not found" });
  const isModerator = req.user!.role === "MANAGER" || req.user!.role === "ADMIN";
  if (existing.authorId !== req.user!.sub && !isModerator) {
    return res.status(403).json({ error: "You can only delete your own posts" });
  }
  if (existing.kind && !existing.kind.startsWith("DISMISSED:")) {
    await db.updateTable("Announcement").set({ kind: `DISMISSED:${existing.kind}` }).where("id", "=", existing.id).execute();
  } else {
    await db.deleteFrom("Announcement").where("id", "=", req.params.id).execute();
  }
  await writeAuditLog({ userId: req.user!.sub, action: "AnnouncementDeleted", targetId: req.params.id });
  res.json({ ok: true });
});
