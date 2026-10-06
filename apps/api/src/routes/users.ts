import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { allow } from "../middleware/rbac";
import { writeAuditLog } from "../utils/audit";

/**
 * Admin: staff account management — add/deactivate users, set roles,
 * reset passwords, adjust leave allowance. Salaries are not here: per the
 * roles table only Payroll can view or set them (see routes/payroll.ts).
 * Admins can't change their own role, status or allowance — another
 * Admin has to.
 */
export const usersRouter = Router();
usersRouter.use(requireAuth, allow("ADMIN"));

const ROLES = ["EMPLOYEE", "MANAGER", "ADMIN", "PAYROLL"] as const;

usersRouter.get("/", async (_req, res) => {
  const users = await db
    .selectFrom("User")
    .select(["id", "name", "email", "role", "country", "status", "jobTitle", "managerId", "birthday", "leaveAllowanceDays", "loginLockedUntil", "createdAt"])
    .orderBy("name", "asc")
    .execute();

  const managerIds = [...new Set(users.map((u) => u.managerId).filter((id): id is string => !!id))];
  const managers = managerIds.length
    ? await db.selectFrom("User").select(["id", "name"]).where("id", "in", managerIds).execute()
    : [];
  const byId = new Map(managers.map((m) => [m.id, m]));

  res.json({
    users: users.map((u) => ({
      ...u,
      locked: !!u.loginLockedUntil && new Date(u.loginLockedUntil) > new Date(),
      manager: u.managerId ? byId.get(u.managerId) ?? null : null,
    })),
  });
});

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(ROLES),
  country: z.enum(["IRELAND", "PHILIPPINES"]),
  jobTitle: z.string().optional(),
  managerId: z.string().optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  leaveAllowanceDays: z.coerce.number().int().min(0).max(365).optional(),
  temporaryPassword: z.string().min(8),
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
      ...(parsed.data.leaveAllowanceDays !== undefined ? { leaveAllowanceDays: parsed.data.leaveAllowanceDays } : {}),
      passwordHash,
      mustResetPassword: true,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await writeAuditLog({
    userId: req.user!.sub,
    action: "UserCreated",
    targetId: user.id,
    metadata: { role: user.role, email: user.email, leaveAllowanceDays: user.leaveAllowanceDays },
  });
  res.status(201).json({ user: publicUser(user) });
});

const updateUserSchema = createUserSchema.partial().omit({ temporaryPassword: true }).extend({
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

usersRouter.patch("/:id", async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid update" });

  const existing = await db.selectFrom("User").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "User not found" });

  const isSelf = existing.id === req.user!.sub;
  const changes = parsed.data;
  if (
    isSelf &&
    ((changes.role !== undefined && changes.role !== existing.role) ||
      (changes.status !== undefined && changes.status !== existing.status) ||
      (changes.leaveAllowanceDays !== undefined && changes.leaveAllowanceDays !== existing.leaveAllowanceDays))
  ) {
    return res.status(403).json({ error: "You can't change your own role, status or leave allowance — another Admin has to." });
  }

  const user = await db
    .updateTable("User")
    .set({ ...changes, ...(changes.email ? { email: changes.email.toLowerCase() } : {}), updatedAt: new Date() })
    .where("id", "=", existing.id)
    .returningAll()
    .executeTakeFirstOrThrow();

  // One entry per kind of change, so the audit log reads as "who did what".
  const actor = req.user!.sub;
  if (changes.role !== undefined && changes.role !== existing.role) {
    await writeAuditLog({ userId: actor, action: "UserRoleChanged", targetId: user.id, metadata: { from: existing.role, to: user.role } });
  }
  if (changes.status !== undefined && changes.status !== existing.status) {
    await writeAuditLog({ userId: actor, action: user.status === "INACTIVE" ? "UserDeactivated" : "UserReactivated", targetId: user.id });
  }
  if (changes.leaveAllowanceDays !== undefined && changes.leaveAllowanceDays !== existing.leaveAllowanceDays) {
    await writeAuditLog({
      userId: actor,
      action: "LeaveAllowanceAdjusted",
      targetId: user.id,
      metadata: { from: existing.leaveAllowanceDays, to: user.leaveAllowanceDays },
    });
  }
  const { role: _r, status: _s, leaveAllowanceDays: _l, ...details } = changes;
  if (Object.keys(details).length > 0) {
    await writeAuditLog({ userId: actor, action: "UserUpdated", targetId: user.id, metadata: details });
  }
  res.json({ user: publicUser(user) });
});

const resetPasswordSchema = z.object({ newPassword: z.string().min(8) });

/** POST /users/:id/reset-password — sets a temporary password (and unlocks a locked account). */
usersRouter.post("/:id/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "newPassword (min 8 chars) is required" });
  if (req.params.id === req.user!.sub) {
    return res.status(403).json({ error: "Use Change Password under Account Security for your own account." });
  }
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  const updated = await db
    .updateTable("User")
    .set({ passwordHash, mustResetPassword: true, failedLoginCount: 0, loginLockedUntil: null, updatedAt: new Date() })
    .where("id", "=", req.params.id)
    .returning("id")
    .executeTakeFirst();
  if (!updated) return res.status(404).json({ error: "User not found" });
  await writeAuditLog({ userId: req.user!.sub, action: "PasswordReset", targetId: req.params.id });
  res.json({ ok: true });
});

function publicUser<T extends { passwordHash: string | null; totpSecret: string | null; totpPendingSecret: string | null }>(u: T) {
  const { passwordHash: _p, totpSecret: _t, totpPendingSecret: _tp, ...rest } = u;
  return rest;
}
