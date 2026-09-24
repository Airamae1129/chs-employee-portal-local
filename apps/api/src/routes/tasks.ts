import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { allow } from "../middleware/rbac";
import { scopedUserIds } from "../utils/team";
import { writeAuditLog } from "../utils/audit";

/**
 * Task assignment: Managers (for their own team) and Admins (for anyone)
 * assign a task with a subject, note and link to an employee for a date.
 * The employee sees it on their calendar and moves it through
 * In Progress -> For Review -> Done.
 */
export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const STATUSES = ["ASSIGNED", "IN_PROGRESS", "FOR_REVIEW", "DONE"] as const;

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

async function withNames<T extends { id: string; assigneeId: string; assignedBy: string }>(tasks: T[]) {
  const ids = [...new Set(tasks.flatMap((t) => [t.assigneeId, t.assignedBy]))];
  const users = ids.length ? await db.selectFrom("User").select(["id", "name"]).where("id", "in", ids).execute() : [];
  const byId = new Map(users.map((u) => [u.id, u.name]));
  const counts = tasks.length
    ? await db
        .selectFrom("TaskComment")
        .select(["taskId", ({ fn }) => fn.countAll<string>().as("n")])
        .where("taskId", "in", tasks.map((t) => t.id))
        .groupBy("taskId")
        .execute()
    : [];
  const countById = new Map(counts.map((c) => [c.taskId, parseInt(c.n, 10)]));
  return tasks.map((t) => ({
    ...t,
    assigneeName: byId.get(t.assigneeId) ?? "Unknown",
    assignedByName: byId.get(t.assignedBy) ?? "Unknown",
    commentCount: countById.get(t.id) ?? 0,
  }));
}

/** GET /tasks/me?month=YYYY-MM — tasks assigned to me (whole list if no month). */
tasksRouter.get("/me", async (req, res) => {
  let query = db.selectFrom("Task").selectAll().where("assigneeId", "=", req.user!.sub);
  const month = req.query.month as string | undefined;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const { start, end } = monthBounds(month);
    query = query.where("dueDate", ">=", start).where("dueDate", "<=", end);
  }
  const tasks = await query.orderBy("dueDate", "asc").execute();
  res.json({ tasks: await withNames(tasks) });
});

/**
 * GET /tasks/assigned — tasks assigned to other people (Admin sees everyone's),
 * with their progress. Personal to-dos people add for themselves stay private.
 */
tasksRouter.get("/assigned", allow("MANAGER", "ADMIN"), async (req, res) => {
  let query = db.selectFrom("Task").selectAll().where((eb) => eb("assigneeId", "!=", eb.ref("assignedBy")));
  if (req.user!.role !== "ADMIN") query = query.where("assignedBy", "=", req.user!.sub);
  const tasks = await query.orderBy("dueDate", "desc").limit(100).execute();
  res.json({ tasks: await withNames(tasks) });
});

/** GET /tasks/assignees — who I'm allowed to assign a task to (active staff in my scope, not myself). */
tasksRouter.get("/assignees", allow("MANAGER", "ADMIN"), async (req, res) => {
  const scope = await scopedUserIds(req.user!);
  let query = db.selectFrom("User").select(["id", "name", "role"]).where("status", "=", "ACTIVE").where("id", "!=", req.user!.sub);
  if (scope !== "ALL") query = query.where("id", "in", scope);
  res.json({ users: await query.orderBy("name", "asc").execute() });
});

const createSchema = z.object({
  assigneeId: z.string().uuid(),
  subject: z.string().trim().min(1).max(200),
  note: z.string().max(2000).optional(),
  link: z.string().trim().url().optional().or(z.literal("")),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

tasksRouter.post("/", allow("MANAGER", "ADMIN"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A subject, an employee and a date are required (the link must be a valid URL)" });
  const { assigneeId, subject, note, link, dueDate } = parsed.data;

  if (assigneeId === req.user!.sub) return res.status(400).json({ error: "Assign tasks to someone else" });
  const scope = await scopedUserIds(req.user!);
  if (scope !== "ALL" && !scope.includes(assigneeId)) {
    return res.status(403).json({ error: "You can only assign tasks to your own team" });
  }
  const assignee = await db.selectFrom("User").select(["id", "status"]).where("id", "=", assigneeId).executeTakeFirst();
  if (!assignee || assignee.status !== "ACTIVE") return res.status(404).json({ error: "Employee not found" });

  const task = await db
    .insertInto("Task")
    .values({ assigneeId, assignedBy: req.user!.sub, subject, note: note || null, link: link || null, dueDate })
    .returningAll()
    .executeTakeFirstOrThrow();

  await writeAuditLog({ userId: req.user!.sub, action: "TaskAssigned", targetId: task.id });
  res.status(201).json({ task });
});

const personalSchema = createSchema.omit({ assigneeId: true });

/** POST /tasks/mine — any role adds a task for themselves (a personal to-do that also shows on their calendar). */
tasksRouter.post("/mine", async (req, res) => {
  const parsed = personalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A subject and a date are required (the link must be a valid URL)" });
  const { subject, note, link, dueDate } = parsed.data;
  const task = await db
    .insertInto("Task")
    .values({ assigneeId: req.user!.sub, assignedBy: req.user!.sub, subject, note: note || null, link: link || null, dueDate })
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ userId: req.user!.sub, action: "TaskCreated", targetId: task.id });
  res.status(201).json({ task });
});

const editSchema = z.object({
  subject: z.string().trim().min(1).max(200).optional(),
  note: z.string().max(2000).optional(),
  link: z.string().trim().url().optional().or(z.literal("")),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** PATCH /tasks/:id — edit the details of a task you created (your own, or one you assigned); Admins can edit any. */
tasksRouter.patch("/:id", async (req, res) => {
  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid task (the link must be a valid URL)" });
  const existing = await db.selectFrom("Task").select(["id", "assignedBy"]).where("id", "=", req.params.id).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "Task not found" });
  if (existing.assignedBy !== req.user!.sub && req.user!.role !== "ADMIN") {
    return res.status(403).json({ error: "You can only edit tasks you created" });
  }
  const { link, note, ...rest } = parsed.data;
  const task = await db
    .updateTable("Task")
    .set({
      ...rest,
      ...(note !== undefined ? { note: note || null } : {}),
      ...(link !== undefined ? { link: link || null } : {}),
      updatedAt: new Date(),
    })
    .where("id", "=", existing.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ userId: req.user!.sub, action: "TaskUpdated", targetId: task.id });
  res.json({ task });
});

const statusSchema = z.object({ status: z.enum(STATUSES) });

/** PATCH /tasks/:id/status — the assignee moves their task along; the assigner and Admins can too. */
tasksRouter.patch("/:id/status", async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Status must be In Progress, For Review or Done" });
  const existing = await db.selectFrom("Task").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "Task not found" });

  const isAssignee = existing.assigneeId === req.user!.sub;
  const isAssigner = existing.assignedBy === req.user!.sub;
  if (!isAssignee && !isAssigner && req.user!.role !== "ADMIN") {
    return res.status(403).json({ error: "You can only update your own tasks" });
  }

  // A new status from the assignee starts a fresh review, so any earlier action is cleared.
  const task = await db
    .updateTable("Task")
    .set({ status: parsed.data.status, actionTaken: null, updatedAt: new Date() })
    .where("id", "=", existing.id)
    .returningAll()
    .executeTakeFirstOrThrow();

  await writeAuditLog({ userId: req.user!.sub, action: "TaskStatusChanged", targetId: task.id, metadata: { status: task.status } });
  res.json({ task });
});

const actionSchema = z.object({ action: z.enum(["APPROVED", "RETURNED"]) });

/**
 * PATCH /tasks/:id/action — the Action Taken on a task sent For Review:
 * APPROVED marks it Done, RETURNED sends it back to In Progress for rework.
 * Only whoever assigned it (or an Admin), and never on personal to-dos.
 */
tasksRouter.patch("/:id/action", allow("MANAGER", "ADMIN"), async (req, res) => {
  const parsed = actionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Action must be Approved or Return" });
  const existing = await db.selectFrom("Task").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "Task not found" });
  if (existing.assigneeId === existing.assignedBy) return res.status(400).json({ error: "Personal tasks don't need approval" });
  if (existing.assignedBy !== req.user!.sub && req.user!.role !== "ADMIN") {
    return res.status(403).json({ error: "You can only review tasks you assigned" });
  }
  if (existing.status !== "FOR_REVIEW") {
    return res.status(400).json({ error: "Only tasks that are For Review can be approved or returned" });
  }
  const task = await db
    .updateTable("Task")
    .set({ status: parsed.data.action === "APPROVED" ? "DONE" : "IN_PROGRESS", actionTaken: parsed.data.action, updatedAt: new Date() })
    .where("id", "=", existing.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ userId: req.user!.sub, action: parsed.data.action === "APPROVED" ? "TaskApproved" : "TaskReturned", targetId: task.id });
  res.json({ task });
});

/** Who may read/write a task's comments: the assignee, whoever assigned it, and Admins. */
async function commentableTask(taskId: string, user: { sub: string; role: string }) {
  const task = await db.selectFrom("Task").select(["id", "assigneeId", "assignedBy"]).where("id", "=", taskId).executeTakeFirst();
  if (!task) return { error: 404 as const };
  if (task.assigneeId !== user.sub && task.assignedBy !== user.sub && user.role !== "ADMIN") return { error: 403 as const };
  return { task };
}

/** GET /tasks/:id/comments */
tasksRouter.get("/:id/comments", async (req, res) => {
  const found = await commentableTask(req.params.id, req.user!);
  if (found.error) return res.status(found.error).json({ error: found.error === 404 ? "Task not found" : "You can't view this task's comments" });
  const comments = await db.selectFrom("TaskComment").selectAll().where("taskId", "=", req.params.id).orderBy("createdAt", "asc").execute();
  const ids = [...new Set(comments.map((c) => c.authorId))];
  const users = ids.length ? await db.selectFrom("User").select(["id", "name", "role"]).where("id", "in", ids).execute() : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  res.json({ comments: comments.map((c) => ({ ...c, authorName: byId.get(c.authorId)?.name ?? "Unknown", authorRole: byId.get(c.authorId)?.role ?? null })) });
});

const commentSchema = z.object({ body: z.string().trim().min(1).max(1000) });

/** POST /tasks/:id/comments */
tasksRouter.post("/:id/comments", async (req, res) => {
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Write a comment (up to 1000 characters)" });
  const found = await commentableTask(req.params.id, req.user!);
  if (found.error) return res.status(found.error).json({ error: found.error === 404 ? "Task not found" : "You can't comment on this task" });
  const comment = await db
    .insertInto("TaskComment")
    .values({ taskId: req.params.id, authorId: req.user!.sub, body: parsed.data.body })
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ userId: req.user!.sub, action: "TaskCommented", targetId: req.params.id });
  res.status(201).json({ comment });
});

/** DELETE /tasks/:id/comments/:commentId — the author or an Admin. */
tasksRouter.delete("/:id/comments/:commentId", async (req, res) => {
  const comment = await db.selectFrom("TaskComment").select(["id", "authorId"]).where("id", "=", req.params.commentId).where("taskId", "=", req.params.id).executeTakeFirst();
  if (!comment) return res.status(404).json({ error: "Comment not found" });
  if (comment.authorId !== req.user!.sub && req.user!.role !== "ADMIN") return res.status(403).json({ error: "You can only delete your own comments" });
  await db.deleteFrom("TaskComment").where("id", "=", comment.id).execute();
  res.json({ ok: true });
});

/** DELETE /tasks/:id — whoever created it (so you can remove your own tasks) or an Admin. */
tasksRouter.delete("/:id", async (req, res) => {
  const existing = await db.selectFrom("Task").select(["id", "assignedBy"]).where("id", "=", req.params.id).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "Task not found" });
  if (existing.assignedBy !== req.user!.sub && req.user!.role !== "ADMIN") {
    return res.status(403).json({ error: "You can only delete tasks you created" });
  }
  await db.deleteFrom("Task").where("id", "=", existing.id).execute();
  await writeAuditLog({ userId: req.user!.sub, action: "TaskDeleted", targetId: existing.id });
  res.json({ ok: true });
});
