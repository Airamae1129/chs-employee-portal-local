import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { allow } from "../middleware/rbac";
import { scopedUserIds } from "../utils/team";

export const calendarRouter = Router();
calendarRouter.use(requireAuth);

function monthRange(month?: string): { start: Date; end: Date } {
  const now = month ? new Date(`${month}-01T00:00:00.000Z`) : new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
  return { start, end };
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * GET /calendar/birthdays — every active employee's birthday (month/day
 * only, the birth year stays private) for the shared calendar note on
 * Timekeeping & Calendar. Visible to all roles.
 */
calendarRouter.get("/birthdays", async (_req, res) => {
  const users = await db
    .selectFrom("User")
    .select(["id", "name", "birthday"])
    .where("status", "=", "ACTIVE")
    .where("birthday", "is not", null)
    .execute();
  res.json({
    birthdays: users.map((u) => ({
      id: u.id,
      name: u.name,
      month: Number(u.birthday!.slice(5, 7)),
      day: Number(u.birthday!.slice(8, 10)),
    })),
  });
});

/**
 * GET /calendar/me?month=YYYY-MM — merged view per Section 5/6: the
 * user's own TimeEvents rolled up per day, approved Leave, their
 * country's Holidays, and their own TaskNotes.
 */
calendarRouter.get("/me", async (req, res) => {
  const { start, end } = monthRange(req.query.month as string | undefined);
  const userId = req.user!.sub;
  const startD = isoDate(start);
  const endD = isoDate(end);

  // Ireland holidays are paid company-wide (Payroll revision), so every
  // user's calendar shows both their own country's holidays and
  // Ireland's — distinguished by `country` so the UI can color-code
  // them differently instead of treating every holiday the same.
  const holidayCountries = req.user!.country === "IRELAND" ? ["IRELAND"] : [req.user!.country, "IRELAND"];

  const [timeEvents, leave, holidays, entries] = await Promise.all([
    db.selectFrom("TimeEvent").selectAll().where("userId", "=", userId).where("timestamp", ">=", start).where("timestamp", "<=", end).execute(),
    db
      .selectFrom("HRRequest")
      .selectAll()
      .where("employeeId", "=", userId)
      .where("requestType", "=", "LEAVE")
      .where("status", "=", "APPROVED")
      .where("startDate", "<=", endD)
      .where("endDate", ">=", startD)
      .execute(),
    db.selectFrom("Holiday").selectAll().where("country", "in", holidayCountries as ("IRELAND" | "PHILIPPINES")[]).where("date", ">=", startD).where("date", "<=", endD).execute(),
    db.selectFrom("CalendarEntry").selectAll().where("userId", "=", userId).where("date", ">=", startD).where("date", "<=", endD).execute(),
  ]);

  res.json({ timeEvents, leave, holidays, entries });
});

const noteSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  title: z.string().min(1),
  notes: z.string().optional(),
});

/** POST /calendar/notes — free-text task note on a date (personal by default). */
calendarRouter.post("/notes", async (req, res) => {
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "date and title are required" });

  const entry = await db
    .insertInto("CalendarEntry")
    .values({
      userId: req.user!.sub,
      date: parsed.data.date,
      entryType: "TASK_NOTE",
      title: parsed.data.title,
      notes: parsed.data.notes ?? null,
      source: "USER",
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  res.status(201).json({ entry });
});

const updateNoteSchema = z.object({
  title: z.string().min(1).optional(),
  notes: z.string().optional(),
  date: z.string().optional(),
});

calendarRouter.patch("/notes/:id", async (req, res) => {
  const existing = await db.selectFrom("CalendarEntry").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "Note not found" });
  if (existing.userId !== req.user!.sub) {
    return res.status(403).json({ error: "You can only edit your own task notes" });
  }
  const parsed = updateNoteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid update" });

  const entry = await db
    .updateTable("CalendarEntry")
    .set({
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      ...(parsed.data.date !== undefined ? { date: parsed.data.date } : {}),
    })
    .where("id", "=", existing.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  res.json({ entry });
});

calendarRouter.delete("/notes/:id", async (req, res) => {
  const existing = await db.selectFrom("CalendarEntry").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "Note not found" });
  const isElevated = req.user!.role === "MANAGER" || req.user!.role === "ADMIN";
  if (existing.userId !== req.user!.sub && !isElevated) {
    return res.status(403).json({ error: "You can only delete your own task notes" });
  }
  await db.deleteFrom("CalendarEntry").where("id", "=", existing.id).execute();
  res.json({ ok: true });
});

/**
 * GET /calendar/team?month= — Manager/Admin read-only view of the
 * team's status/leave/holidays/task notes (Section 6: "read-only, not
 * editable by the manager" for task notes).
 */
calendarRouter.get("/team", allow("MANAGER", "ADMIN"), async (req, res) => {
  const { start, end } = monthRange(req.query.month as string | undefined);
  const startD = isoDate(start);
  const endD = isoDate(end);
  const scope = await scopedUserIds(req.user!);

  let timeQuery = db.selectFrom("TimeEvent").selectAll().where("timestamp", ">=", start).where("timestamp", "<=", end);
  let entryQuery = db.selectFrom("CalendarEntry").selectAll().where("date", ">=", startD).where("date", "<=", endD);
  let leaveQuery = db
    .selectFrom("HRRequest")
    .selectAll()
    .where("requestType", "=", "LEAVE")
    .where("status", "=", "APPROVED")
    .where("startDate", "<=", endD)
    .where("endDate", ">=", startD);
  let userQuery = db.selectFrom("User").select(["id", "name", "country"]);

  if (scope !== "ALL") {
    timeQuery = timeQuery.where("userId", "in", scope);
    entryQuery = entryQuery.where("userId", "in", scope);
    leaveQuery = leaveQuery.where("employeeId", "in", scope);
    userQuery = userQuery.where("id", "in", scope);
  }

  const [timeEvents, entries, leave, users] = await Promise.all([
    timeQuery.execute(),
    entryQuery.execute(),
    leaveQuery.execute(),
    userQuery.execute(),
  ]);

  const holidaysByCountry: Record<string, unknown[]> = {};
  for (const country of new Set(users.map((u) => u.country))) {
    holidaysByCountry[country] = await db
      .selectFrom("Holiday")
      .selectAll()
      .where("country", "=", country)
      .where("date", ">=", startD)
      .where("date", "<=", endD)
      .execute();
  }

  res.json({ users, timeEvents, leave, entries, holidaysByCountry });
});
