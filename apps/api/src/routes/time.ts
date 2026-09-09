import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { allow } from "../middleware/rbac";
import { scopedUserIds } from "../utils/team";
import { postClockEventToTeams } from "../utils/teams";
import { writeAuditLog } from "../utils/audit";
import { IE_TIME_ZONE, nextMidnightInZone } from "../utils/time";

export const timeRouter = Router();
timeRouter.use(requireAuth);

const clockSchema = z.object({
  eventType: z.enum(["IN", "OUT"]),
  deviceId: z.string().optional(),
  notes: z.string().optional(),
});

/** POST /time/clock — clock in/out. Section 8: write first, notify Teams async. */
timeRouter.post("/clock", async (req, res) => {
  const parsed = clockSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "eventType (IN|OUT) is required" });

  const timeEvent = await db
    .insertInto("TimeEvent")
    .values({
      userId: req.user!.sub,
      eventType: parsed.data.eventType,
      timestamp: new Date(),
      deviceId: parsed.data.deviceId ?? null,
      notes: parsed.data.notes ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  res.status(201).json({ timeEvent });

  // Fire-and-forget: never block the response on Teams availability.
  (async () => {
    let hoursWorkedToday: number | null = null;
    if (parsed.data.eventType === "OUT") {
      const startOfDay = new Date(timeEvent.timestamp);
      startOfDay.setUTCHours(0, 0, 0, 0);
      const todaysEvents = await db
        .selectFrom("TimeEvent")
        .selectAll()
        .where("userId", "=", req.user!.sub)
        .where("timestamp", ">=", startOfDay)
        .orderBy("timestamp", "asc")
        .execute();
      hoursWorkedToday = computeHoursWorked(todaysEvents);
    }
    await postClockEventToTeams({
      timeEventId: timeEvent.id,
      userId: req.user!.sub,
      userName: req.user!.name,
      eventType: parsed.data.eventType,
      timestampUtc: new Date(timeEvent.timestamp),
      hoursWorkedToday,
    });
  })().catch(() => void 0);
});

function computeHoursWorked(events: { eventType: string; timestamp: Date | string }[]): number {
  let total = 0;
  let lastIn: Date | null = null;
  for (const e of events) {
    const ts = new Date(e.timestamp);
    if (e.eventType === "IN") lastIn = ts;
    else if (e.eventType === "OUT" && lastIn) {
      total += (ts.getTime() - lastIn.getTime()) / 3_600_000;
      lastIn = null;
    }
  }
  return total;
}

/** GET /time/me?range=YYYY-MM-DD,YYYY-MM-DD — own time log */
timeRouter.get("/me", async (req, res) => {
  const { from, to } = parseRange(req.query.range as string | undefined);
  const events = await db
    .selectFrom("TimeEvent")
    .selectAll()
    .where("userId", "=", req.user!.sub)
    .where("timestamp", ">=", from)
    .where("timestamp", "<=", to)
    .orderBy("timestamp", "desc")
    .execute();
  res.json({ events });
});

/** GET /time/team?range= — Manager (own reports) / Admin (all) */
timeRouter.get("/team", allow("MANAGER", "ADMIN"), async (req, res) => {
  const { from, to } = parseRange(req.query.range as string | undefined);
  const scope = await scopedUserIds(req.user!);

  let query = db.selectFrom("TimeEvent").selectAll().where("timestamp", ">=", from).where("timestamp", "<=", to);
  if (scope !== "ALL") query = query.where("userId", "in", scope);
  const rawEvents = await query.orderBy("timestamp", "desc").execute();

  const userIds = [...new Set(rawEvents.map((e) => e.userId))];
  const users = userIds.length
    ? await db.selectFrom("User").select(["id", "name", "email", "country"]).where("id", "in", userIds).execute()
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const events = rawEvents.map((e) => ({ ...e, user: userById.get(e.userId) }));

  // Exception view (Timekeeping revision: "if user did not logout after
  // 12 AM in Ireland considered as MISSING CLOCK OUT"): an IN event with
  // no later OUT is only flagged once Ireland local time has rolled past
  // the midnight following that IN — still-open same-Ireland-day
  // sessions are normal, not exceptions yet.
  const now = new Date();
  const openSessions = events.filter((e) => e.eventType === "IN");
  const missingClockOuts = openSessions.filter((inEvt) => {
    const hasLaterOut = events.some(
      (e) => e.userId === inEvt.userId && e.eventType === "OUT" && new Date(e.timestamp) > new Date(inEvt.timestamp)
    );
    if (hasLaterOut) return false;
    const cutoff = nextMidnightInZone(new Date(inEvt.timestamp), IE_TIME_ZONE);
    return now > cutoff;
  });

  res.json({ events, exceptions: { missingClockOuts } });
});

const manualEntrySchema = z.object({
  userId: z.string(),
  eventType: z.enum(["IN", "OUT"]),
  timestamp: z.string().datetime(),
  notes: z.string().optional(),
});

/**
 * POST /time/entry — manage your own time entries (Employee/Manager
 * revision: self-service only). Admin can add for anyone; Managers lost
 * team-editing access here — they get the automatic missing-clock-out
 * notification instead (see routes/notifications.ts).
 */
timeRouter.post("/entry", async (req, res) => {
  const parsed = manualEntrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "userId, eventType and timestamp are required" });

  if (req.user!.role !== "ADMIN" && parsed.data.userId !== req.user!.sub) {
    return res.status(403).json({ error: "You can only add your own time entries" });
  }

  const timeEvent = await db
    .insertInto("TimeEvent")
    .values({
      userId: parsed.data.userId,
      eventType: parsed.data.eventType,
      timestamp: new Date(parsed.data.timestamp),
      notes: parsed.data.notes ? `[Added by ${req.user!.name}]: ${parsed.data.notes}` : `[Manually added by ${req.user!.name}]`,
      status: "EDITED",
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ userId: req.user!.sub, action: "TimeEntryAdded", targetId: timeEvent.id, metadata: { forUserId: parsed.data.userId } });
  res.status(201).json({ timeEvent });
});

/** DELETE /time/:id — remove your own incorrect time entry (Admin can remove anyone's). */
timeRouter.delete("/:id", async (req, res) => {
  const existing = await db.selectFrom("TimeEvent").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "Time event not found" });

  if (req.user!.role !== "ADMIN" && existing.userId !== req.user!.sub) {
    return res.status(403).json({ error: "You can only delete your own time entries" });
  }

  await db.deleteFrom("TimeEvent").where("id", "=", req.params.id).execute();
  await writeAuditLog({ userId: req.user!.sub, action: "TimeEntryDeleted", targetId: req.params.id, metadata: { forUserId: existing.userId } });
  res.json({ ok: true });
});

const correctionSchema = z.object({
  timeEventId: z.string(),
  correctedTimestamp: z.string().datetime().optional(),
  notes: z.string().min(1),
});

/** POST /time/correction — request/apply a correction to a time event. */
timeRouter.post("/correction", async (req, res) => {
  const parsed = correctionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid correction payload" });

  const existing = await db.selectFrom("TimeEvent").selectAll().where("id", "=", parsed.data.timeEventId).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "Time event not found" });

  const isOwner = existing.userId === req.user!.sub;
  const isAdmin = req.user!.role === "ADMIN";
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: "You can only edit your own time entries" });
  }

  if ((isOwner || isAdmin) && parsed.data.correctedTimestamp) {
    const updated = await db
      .updateTable("TimeEvent")
      .set({
        timestamp: new Date(parsed.data.correctedTimestamp),
        status: "EDITED",
        notes: `${existing.notes ?? ""}\n[Corrected by ${req.user!.name}]: ${parsed.data.notes}`.trim(),
      })
      .where("id", "=", existing.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await writeAuditLog({
      userId: req.user!.sub,
      action: "TimeEdited",
      targetId: existing.id,
      metadata: { previousTimestamp: existing.timestamp, newTimestamp: updated.timestamp },
    });
    return res.json({ timeEvent: updated });
  }

  const updated = await db
    .updateTable("TimeEvent")
    .set({ notes: `${existing.notes ?? ""}\n[Correction requested]: ${parsed.data.notes}`.trim() })
    .where("id", "=", existing.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  res.json({ timeEvent: updated, message: "Correction request submitted for review" });
});

function parseRange(range?: string): { from: Date; to: Date } {
  if (!range) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 14);
    return { from, to };
  }
  const [fromStr, toStr] = range.split(",");
  return { from: new Date(fromStr), to: toStr ? new Date(toStr) : new Date() };
}
