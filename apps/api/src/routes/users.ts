import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { allow } from "../middleware/rbac";
import { writeAuditLog } from "../utils/audit";
import { countWeekdaysInMonth } from "../utils/time";

/** Admin: staff account management (Section 1 "Staff accounts", Section 3 user mgmt). */
export const usersRouter = Router();
usersRouter.use(requireAuth, allow("ADMIN"));

usersRouter.get("/", async (_req, res) => {
  const users = await db
    .selectFrom("User")
    .select(["id", "name", "email", "role", "country", "status", "jobTitle", "managerId", "birthday", "createdAt"])
    .orderBy("name", "asc")
    .execute();

  const managerIds = [...new Set(users.map((u) => u.managerId).filter((id): id is string => !!id))];
  const managers = managerIds.length
    ? await db.selectFrom("User").select(["id", "name"]).where("id", "in", managerIds).execute()
    : [];
  const byId = new Map(managers.map((m) => [m.id, m]));

  const salaries = await db.selectFrom("SalaryConfig").select(["userId", "baseRate", "currency"]).execute();
  const salaryByUserId = new Map(salaries.map((s) => [s.userId, s]));

  res.json({
    users: users.map((u) => ({
      ...u,
      manager: u.managerId ? byId.get(u.managerId) ?? null : null,
      salary: salaryByUserId.get(u.id)?.baseRate ?? null,
      salaryCurrency: salaryByUserId.get(u.id)?.currency ?? null,
    })),
  });
});

async function upsertSalary(userId: string, salary: number, country: "IRELAND" | "PHILIPPINES") {
  const now = new Date();
  const standardWorkingDays = countWeekdaysInMonth(now.getFullYear(), now.getMonth() + 1);
  const currency = country === "IRELAND" ? "EUR" : "PHP";
  const existing = await db.selectFrom("SalaryConfig").select("userId").where("userId", "=", userId).executeTakeFirst();
  if (existing) {
    await db.updateTable("SalaryConfig").set({ baseRate: String(salary), standardWorkingDays, currency, updatedAt: now }).where("userId", "=", userId).execute();
  } else {
    await db.insertInto("SalaryConfig").values({ userId, salaryType: "MONTHLY", baseRate: String(salary), standardWorkingDays, currency }).execute();
  }
}

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["EMPLOYEE", "MANAGER", "ADMIN"]),
  country: z.enum(["IRELAND", "PHILIPPINES"]),
  jobTitle: z.string().optional(),
  managerId: z.string().optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  temporaryPassword: z.string().min(8),
  salary: z.coerce.number().positive().optional(),
});

usersRouter.post("/", async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid user payload", details: parsed.error.flatten() });

  const passwordHash = await bcrypt.hash(parsed.data.temporaryPassword, 10);
  const user = await db
    .insertInto("User")
    .values({
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
      country: parsed.data.country,
      jobTitle: parsed.data.jobTitle ?? null,
      managerId: parsed.data.managerId ?? null,
      birthday: parsed.data.birthday ?? null,
      passwordHash,
      mustResetPassword: true,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  if (parsed.data.salary) await upsertSalary(user.id, parsed.data.salary, parsed.data.country);

  await writeAuditLog({ userId: req.user!.sub, action: "UserCreated", targetId: user.id });
  res.status(201).json({ user: { ...user, passwordHash: undefined } });
});

const updateUserSchema = createUserSchema.partial().omit({ temporaryPassword: true }).extend({
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

usersRouter.patch("/:id", async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid update" });
  const { salary, ...rest } = parsed.data;
  const user = await db
    .updateTable("User")
    .set({ ...rest, updatedAt: new Date() })
    .where("id", "=", req.params.id)
    .returningAll()
    .executeTakeFirstOrThrow();

  if (salary) await upsertSalary(user.id, salary, user.country);

  await writeAuditLog({ userId: req.user!.sub, action: "UserUpdated", targetId: user.id, metadata: parsed.data });
  res.json({ user: { ...user, passwordHash: undefined } });
});

const resetPasswordSchema = z.object({ newPassword: z.string().min(8) });

/** POST /users/:id/reset-password — "Forgotten password? An administrator can reset it under Users." */
usersRouter.post("/:id/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "newPassword (min 8 chars) is required" });
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await db.updateTable("User").set({ passwordHash, mustResetPassword: true, updatedAt: new Date() }).where("id", "=", req.params.id).execute();
  await writeAuditLog({ userId: req.user!.sub, action: "PasswordReset", targetId: req.params.id });
  res.json({ ok: true });
});
