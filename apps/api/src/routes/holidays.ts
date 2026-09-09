import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { allow } from "../middleware/rbac";
import { writeAuditLog } from "../utils/audit";

export const holidaysRouter = Router();
holidaysRouter.use(requireAuth);

/** GET /holidays?country=&year= — any authenticated user (their own calendar overlay). */
holidaysRouter.get("/", async (req, res) => {
  const country = (req.query.country as string) ?? req.user!.country;
  const year = req.query.year ? parseInt(req.query.year as string, 10) : new Date().getFullYear();
  const holidays = await db
    .selectFrom("Holiday")
    .selectAll()
    .where("country", "=", country as "IRELAND" | "PHILIPPINES")
    .where("year", "=", year)
    .orderBy("date", "asc")
    .execute();
  res.json({ holidays });
});

const holidaySchema = z.object({
  country: z.enum(["IRELAND", "PHILIPPINES"]),
  date: z.string(),
  name: z.string().min(1),
  type: z.enum(["PUBLIC_HOLIDAY", "BANK_HOLIDAY", "REGULAR_HOLIDAY", "SPECIAL_NON_WORKING_DAY"]),
  year: z.number().int(),
});

/** POST /holidays — Admin maintains the per-year holiday calendars (Section 6). */
holidaysRouter.post("/", allow("ADMIN"), async (req, res) => {
  const parsed = holidaySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid holiday payload" });

  const holiday = await db
    .insertInto("Holiday")
    .values({ ...parsed.data, source: "MANUAL" })
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ userId: req.user!.sub, action: "HolidayCreated", targetId: holiday.id, metadata: parsed.data });
  res.status(201).json({ holiday });
});

const holidayUpdateSchema = holidaySchema.partial();

holidaysRouter.put("/:id", allow("ADMIN"), async (req, res) => {
  const parsed = holidayUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid holiday payload" });

  const holiday = await db
    .updateTable("Holiday")
    .set({ ...parsed.data })
    .where("id", "=", req.params.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ userId: req.user!.sub, action: "HolidayEdited", targetId: holiday.id, metadata: parsed.data });
  res.json({ holiday });
});

holidaysRouter.delete("/:id", allow("ADMIN"), async (req, res) => {
  await db.deleteFrom("Holiday").where("id", "=", req.params.id).execute();
  await writeAuditLog({ userId: req.user!.sub, action: "HolidayDeleted", targetId: req.params.id });
  res.json({ ok: true });
});
