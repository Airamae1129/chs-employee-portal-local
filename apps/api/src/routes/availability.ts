import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { allow } from "../middleware/rbac";
import { scopedUserIds } from "../utils/team";

/**
 * Phase 2 — Team availability / resourcing. Backed by ResourceAllocation
 * for now; Section 6 also allows sourcing this from a Microsoft Graph
 * free/busy pull instead/in addition — see the TODO below for where
 * that would plug in.
 */
export const availabilityRouter = Router();
availabilityRouter.use(requireAuth);

availabilityRouter.get("/team", allow("MANAGER", "ADMIN"), async (req, res) => {
  const weekStart = req.query.week ? String(req.query.week) : new Date().toISOString().slice(0, 10);
  const scope = await scopedUserIds(req.user!);

  let query = db.selectFrom("ResourceAllocation").selectAll().where("weekStartDate", "=", weekStart);
  if (scope !== "ALL") query = query.where("userId", "in", scope);
  const allocations = await query.execute();

  const userIds = [...new Set(allocations.map((a) => a.userId))];
  const users = userIds.length
    ? await db.selectFrom("User").select(["id", "name", "country"]).where("id", "in", userIds).execute()
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  // TODO (Phase 2 stretch): merge in Microsoft Graph /me/calendar/getSchedule
  // free/busy results per user for a fuller resourcing picture, once
  // Entra ID app permissions include Calendars.Read.Shared.

  res.json({ allocations: allocations.map((a) => ({ ...a, user: byId.get(a.userId) })) });
});

const allocationSchema = z.object({
  userId: z.string(),
  weekStartDate: z.string(),
  project: z.string().min(1),
  allocationPercent: z.number().int().min(0).max(100),
});

availabilityRouter.post("/", allow("MANAGER", "ADMIN"), async (req, res) => {
  const parsed = allocationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid allocation payload" });

  const allocation = await db.insertInto("ResourceAllocation").values(parsed.data).returningAll().executeTakeFirstOrThrow();
  res.status(201).json({ allocation });
});
