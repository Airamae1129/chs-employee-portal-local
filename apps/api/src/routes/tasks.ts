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
const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = {
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  FOR_REVIEW: "For Review",
  DONE: "Done",
};

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

async function withNames<T extends { assigneeId: string; assignedBy: string }>(tasks: T[]) {
  const ids = [...new Set(tasks.flatMap((t) => [t.assigneeId, t.assignedBy]))];
  const users = ids.length ? await db.selectFrom("User").select(["id", "name"]).where("id", "in", ids).execute() : [];
  const byId = new Map(users.map((u) => [u.id, u.name]));
  return tasks.map((t) => ({ ...t, assigneeName: byId.get(t.assigneeId) ?? "Unknown", assignedByName: byId.get(t.assignedBy) ?? "Unknown" }));
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

/** GET /tasks/assigned — tasks I assigned (Admin sees everyone's), with their progress. */
tasksRouter.get("/assigned", allow("MANAGER", "ADMIN"), async (req, res) => {
  let query = db.selectFrom("Task").selectAll();
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

  await db
    .insertInto("Notification")
    .values({ userId: assigneeId, type: "TASK_ASSIGNED", message: `${req.user!.name} assigned you a task: ${subject}`, relatedDate: dueDate })
    .execute();
  await writeAuditLog({ userId: req.user!.sub, action: "TaskAssigned", targetId: task.id });
  res.status(201).json({ task });
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

  const task = await db
    .updateTable("Task")
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where("id", "=", existing.id)
    .returningAll()
    .executeTakeFirstOrThrow();

  // Let the person who assigned it know when the assignee moves it.
  if (isAssignee && existing.assignedBy !== req.user!.sub && existing.status !== task.status) {
    await db
      .insertInto("Notification")
      .values({
        userId: existing.assignedBy,
        type: "TASK_STATUS",
        message: `${req.user!.name} marked "${existing.subject}" as ${STATUS_LABEL[task.status]}`,
        relatedDate: existing.dueDate,
      })
      .execute();
  }
  await writeAuditLog({ userId: req.user!.sub, action: "TaskStatusChanged", targetId: task.id, metadata: { status: task.status } });
  res.json({ task });
});

/** DELETE /tasks/:id — the assigner or an Admin. */
tasksRouter.delete("/:id", allow("MANAGER", "ADMIN"), async (req, res) => {
  const existing = await db.selectFrom("Task").select(["id", "assignedBy"]).where("id", "=", req.params.id).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "Task not found" });
  if (existing.assignedBy !== req.user!.sub && req.user!.role !== "ADMIN") {
    return res.status(403).json({ error: "You can only delete tasks you assigned" });
  }
  await db.deleteFrom("Task").where("id", "=", existing.id).execute();
  await writeAuditLog({ userId: req.user!.sub, action: "TaskDeleted", targetId: existing.id });
  res.json({ ok: true });
});
