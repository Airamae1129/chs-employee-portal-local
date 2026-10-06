import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { allow } from "../middleware/rbac";
import { approvalScope, canActFor, OWN_APPROVAL_MESSAGE, scopedUserIds } from "../utils/team";
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

/** GET /time/team?range= — read-only: Manager (own reports) / Admin and Payroll (everyone). */
timeRouter.get("/team", allow("MANAGER", "ADMIN", "PAYROLL"), async (req, res) => {
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

// ---------- Corrections to your own entries (roles table: "Request correction to own entry (reason required)") ----------
//
// Nobody edits their own clock records directly. They ask for a change,
// with a reason, and someone else — their manager, or an Admin — approves
// it (see canActFor). Approving applies the change to TimeEvent.

const correctionRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ADD"), eventType: z.enum(["IN", "OUT"]), timestamp: z.string().datetime(), reason: z.string().trim().min(3) }),
  z.object({ action: z.literal("EDIT"), timeEventId: z.string().uuid(), timestamp: z.string().datetime(), reason: z.string().trim().min(3) }),
  z.object({ action: z.literal("DELETE"), timeEventId: z.string().uuid(), reason: z.string().trim().min(3) }),
]);

const REASON_REQUIRED = "Please give a reason (at least 3 characters).";

/** POST /time/corrections — ask for an entry of your own to be added, changed or removed. */
timeRouter.post("/corrections", async (req, res) => {
  const parsed = correctionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const missingReason = parsed.error.issues.some((i) => i.path[0] === "reason");
    return res.status(400).json({ error: missingReason ? REASON_REQUIRED : "Invalid correction request" });
  }
  const data = parsed.data;

  let originalTimestamp: Date | null = null;
  let eventType: "IN" | "OUT" | null = data.action === "ADD" ? data.eventType : null;
  if (data.action !== "ADD") {
    const event = await db.selectFrom("TimeEvent").selectAll().where("id", "=", data.timeEventId).executeTakeFirst();
    if (!event) return res.status(404).json({ error: "Time entry not found" });
    if (event.userId !== req.user!.sub) return res.status(403).json({ error: "You can only request corrections to your own entries" });
    const pending = await db
      .selectFrom("TimeCorrectionRequest")
      .select("id")
      .where("timeEventId", "=", event.id)
      .where("status", "=", "SUBMITTED")
      .executeTakeFirst();
    if (pending) return res.status(409).json({ error: "There's already a pending correction request for this entry." });
    originalTimestamp = new Date(event.timestamp);
    eventType = event.eventType;
  }

  const request = await db
    .insertInto("TimeCorrectionRequest")
    .values({
      userId: req.user!.sub,
      action: data.action,
      timeEventId: data.action === "ADD" ? null : data.timeEventId,
      eventType,
      requestedTimestamp: data.action === "DELETE" ? null : new Date(data.timestamp),
      originalTimestamp,
      reason: data.reason,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await writeAuditLog({ userId: req.user!.sub, action: "TimeCorrectionRequested", targetId: request.id, metadata: { action: data.action, reason: data.reason } });

  // The request goes to the requester's manager (Admins see every request too).
  const me = await db.selectFrom("User").select("managerId").where("id", "=", req.user!.sub).executeTakeFirst();
  if (me?.managerId) {
    await db
      .insertInto("Notification")
      .values({
        userId: me.managerId,
        type: "TIME_CORRECTION_REQUEST",
        message: `${req.user!.name} asked for a time entry correction: ${data.reason}`,
        relatedDate: (data.action === "DELETE" ? originalTimestamp! : new Date(data.timestamp)).toISOString().slice(0, 10),
      })
      .execute();
  }

  res.status(201).json({ request });
});

/** GET /time/corrections/me — your own correction requests. */
timeRouter.get("/corrections/me", async (req, res) => {
  const requests = await db
    .selectFrom("TimeCorrectionRequest")
    .selectAll()
    .where("userId", "=", req.user!.sub)
    .orderBy("createdAt", "desc")
    .limit(50)
    .execute();
  res.json({ requests: await withDeciderNames(requests) });
});

/** POST /time/corrections/:id/cancel — withdraw your own pending request. */
timeRouter.post("/corrections/:id/cancel", async (req, res) => {
  const request = await db.selectFrom("TimeCorrectionRequest").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!request || request.userId !== req.user!.sub) return res.status(404).json({ error: "Request not found" });
  if (request.status !== "SUBMITTED") return res.status(400).json({ error: "Only pending requests can be cancelled" });
  await db.updateTable("TimeCorrectionRequest").set({ status: "CANCELLED" }).where("id", "=", request.id).execute();
  await writeAuditLog({ userId: req.user!.sub, action: "TimeCorrectionCancelled", targetId: request.id });
  res.json({ ok: true });
});

/** GET /time/corrections/pending — requests waiting for the caller: a Manager's direct reports, or anyone else's for an Admin. */
timeRouter.get("/corrections/pending", allow("MANAGER", "ADMIN"), async (req, res) => {
  const scope = await approvalScope(req.user!);
  if (Array.isArray(scope) && scope.length === 0) return res.json({ requests: [] });
  let query = db
    .selectFrom("TimeCorrectionRequest")
    .selectAll()
    .where("status", "=", "SUBMITTED")
    .where("userId", "!=", req.user!.sub);
  if (scope !== "OTHERS") query = query.where("userId", "in", scope);
  const requests = await query.orderBy("createdAt", "asc").execute();

  const userIds = [...new Set(requests.map((r) => r.userId))];
  const users = userIds.length ? await db.selectFrom("User").select(["id", "name"]).where("id", "in", userIds).execute() : [];
  const byId = new Map(users.map((u) => [u.id, u.name]));
  res.json({ requests: requests.map((r) => ({ ...r, userName: byId.get(r.userId) ?? "Unknown" })) });
});

const correctionDecisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(500).optional(),
});

/** PATCH /time/corrections/:id/decision — approve (applies the change) or reject someone else's request. */
timeRouter.patch("/corrections/:id/decision", allow("MANAGER", "ADMIN"), async (req, res) => {
  const parsed = correctionDecisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "decision (APPROVED|REJECTED) is required" });
  const request = await db.selectFrom("TimeCorrectionRequest").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!request) return res.status(404).json({ error: "Request not found" });
  if (request.userId === req.user!.sub) return res.status(403).json({ error: OWN_APPROVAL_MESSAGE });
  if (!(await canActFor(req.user!, request.userId))) {
    return res.status(403).json({ error: "You can only decide on requests from your own team" });
  }
  if (request.status !== "SUBMITTED") return res.status(400).json({ error: "This request has already been decided" });

  const decider = req.user!.name;
  const approved = parsed.data.decision === "APPROVED";

  if (approved) {
    const note = `[Correction approved by ${decider}]: ${request.reason}`;
    if (request.action === "ADD") {
      await db
        .insertInto("TimeEvent")
        .values({ userId: request.userId, eventType: request.eventType!, timestamp: request.requestedTimestamp!, notes: note, status: "EDITED" })
        .execute();
    } else {
      const event = request.timeEventId
        ? await db.selectFrom("TimeEvent").selectAll().where("id", "=", request.timeEventId).executeTakeFirst()
        : undefined;
      if (!event) return res.status(409).json({ error: "The time entry no longer exists. Reject this request instead." });
      if (request.action === "EDIT") {
        await db
          .updateTable("TimeEvent")
          .set({ timestamp: request.requestedTimestamp!, status: "EDITED", notes: `${event.notes ?? ""}\n${note}`.trim() })
          .where("id", "=", event.id)
          .execute();
      } else {
        await db.deleteFrom("TimeEvent").where("id", "=", event.id).execute();
      }
    }
  }

  await db
    .updateTable("TimeCorrectionRequest")
    .set({ status: parsed.data.decision, decidedById: req.user!.sub, decidedAt: new Date(), decisionNote: parsed.data.note || null })
    .where("id", "=", request.id)
    .execute();
  await writeAuditLog({
    userId: req.user!.sub,
    action: approved ? "TimeCorrectionApproved" : "TimeCorrectionRejected",
    targetId: request.id,
    metadata: {
      forUserId: request.userId,
      action: request.action,
      reason: request.reason,
      from: request.originalTimestamp,
      to: request.requestedTimestamp,
      note: parsed.data.note ?? null,
    },
  });
  await db
    .insertInto("Notification")
    .values({
      userId: request.userId,
      type: "TIME_CORRECTION_DECIDED",
      message: `Your time correction request was ${approved ? "approved" : "rejected"} by ${decider}${parsed.data.note ? `: ${parsed.data.note}` : "."}`,
      relatedDate: null,
    })
    .execute();
  res.json({ ok: true });
});

// ---------- Editing another person's entries (roles table: "edit another person's entry (reason required)") ----------
//
// Managers (their direct reports) and Admins (anyone else) may add, change
// or remove someone else's entry directly — never their own — and must
// give a reason, which goes into the audit log.

async function requireActFor(req: import("express").Request, res: import("express").Response, targetUserId: string): Promise<boolean> {
  if (targetUserId === req.user!.sub) {
    res.status(403).json({ error: "Changes to your own entries need a correction request approved by someone else." });
    return false;
  }
  if (!(await canActFor(req.user!, targetUserId))) {
    res.status(403).json({ error: "You can only edit entries for your own team" });
    return false;
  }
  return true;
}

const reasonSchema = z.string().trim().min(3);

const otherEntrySchema = z.object({
  userId: z.string().uuid(),
  eventType: z.enum(["IN", "OUT"]),
  timestamp: z.string().datetime(),
  reason: reasonSchema,
});

/** POST /time/entries — add an entry for someone in your scope. */
timeRouter.post("/entries", allow("MANAGER", "ADMIN"), async (req, res) => {
  const parsed = otherEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.some((i) => i.path[0] === "reason") ? REASON_REQUIRED : "userId, eventType and timestamp are required" });
  }
  if (!(await requireActFor(req, res, parsed.data.userId))) return;
  const timeEvent = await db
    .insertInto("TimeEvent")
    .values({
      userId: parsed.data.userId,
      eventType: parsed.data.eventType,
      timestamp: new Date(parsed.data.timestamp),
      notes: `[Added by ${req.user!.name}]: ${parsed.data.reason}`,
      status: "EDITED",
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({
    userId: req.user!.sub,
    action: "TimeEntryAdded",
    targetId: timeEvent.id,
    metadata: { forUserId: parsed.data.userId, eventType: parsed.data.eventType, timestamp: timeEvent.timestamp, reason: parsed.data.reason },
  });
  res.status(201).json({ timeEvent });
});

/** PATCH /time/entries/:id — change the time of someone else's entry. */
timeRouter.patch("/entries/:id", allow("MANAGER", "ADMIN"), async (req, res) => {
  const parsed = z.object({ timestamp: z.string().datetime(), reason: reasonSchema }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.some((i) => i.path[0] === "reason") ? REASON_REQUIRED : "A new time is required" });
  }
  const existing = await db.selectFrom("TimeEvent").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "Time entry not found" });
  if (!(await requireActFor(req, res, existing.userId))) return;
  const updated = await db
    .updateTable("TimeEvent")
    .set({
      timestamp: new Date(parsed.data.timestamp),
      status: "EDITED",
      notes: `${existing.notes ?? ""}\n[Corrected by ${req.user!.name}]: ${parsed.data.reason}`.trim(),
    })
    .where("id", "=", existing.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({
    userId: req.user!.sub,
    action: "TimeEdited",
    targetId: existing.id,
    metadata: { forUserId: existing.userId, previousTimestamp: existing.timestamp, newTimestamp: updated.timestamp, reason: parsed.data.reason },
  });
  res.json({ timeEvent: updated });
});

/** DELETE /time/entries/:id — remove someone else's entry ({ reason } in the body). */
timeRouter.delete("/entries/:id", allow("MANAGER", "ADMIN"), async (req, res) => {
  const reason = reasonSchema.safeParse(req.body?.reason);
  if (!reason.success) return res.status(400).json({ error: REASON_REQUIRED });
  const existing = await db.selectFrom("TimeEvent").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "Time entry not found" });
  if (!(await requireActFor(req, res, existing.userId))) return;
  await db.deleteFrom("TimeEvent").where("id", "=", existing.id).execute();
  await writeAuditLog({
    userId: req.user!.sub,
    action: "TimeEntryDeleted",
    targetId: existing.id,
    metadata: { forUserId: existing.userId, eventType: existing.eventType, timestamp: existing.timestamp, reason: reason.data },
  });
  res.json({ ok: true });
});

/** GET /time/editable-users — people whose entries the caller may edit (never themselves). */
timeRouter.get("/editable-users", allow("MANAGER", "ADMIN"), async (req, res) => {
  const scope = await approvalScope(req.user!);
  let query = db.selectFrom("User").select(["id", "name", "country"]).where("status", "=", "ACTIVE").where("id", "!=", req.user!.sub);
  if (scope !== "OTHERS") {
    if (scope.length === 0) return res.json({ users: [] });
    query = query.where("id", "in", scope);
  }
  res.json({ users: await query.orderBy("name", "asc").execute() });
});

/** GET /time/user/:userId?range= — someone else's entries, for a caller allowed to edit them. */
timeRouter.get("/user/:userId", allow("MANAGER", "ADMIN"), async (req, res) => {
  if (!(await requireActFor(req, res, req.params.userId))) return;
  const { from, to } = parseRange(req.query.range as string | undefined);
  const events = await db
    .selectFrom("TimeEvent")
    .selectAll()
    .where("userId", "=", req.params.userId)
    .where("timestamp", ">=", from)
    .where("timestamp", "<=", to)
    .orderBy("timestamp", "desc")
    .execute();
  res.json({ events });
});

async function withDeciderNames<T extends { decidedById: string | null }>(requests: T[]) {
  const ids = [...new Set(requests.map((r) => r.decidedById).filter((id): id is string => !!id))];
  const users = ids.length ? await db.selectFrom("User").select(["id", "name"]).where("id", "in", ids).execute() : [];
  const byId = new Map(users.map((u) => [u.id, u.name]));
  return requests.map((r) => ({ ...r, decidedByName: r.decidedById ? byId.get(r.decidedById) ?? null : null }));
}

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
