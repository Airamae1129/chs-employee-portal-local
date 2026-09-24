import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { allow } from "../middleware/rbac";
import { getStorageAdapter } from "../utils/storage";
import { writeAuditLog } from "../utils/audit";

export const payslipsRouter = Router();
payslipsRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * GET /payslips/me — every employee (any role, any country) sees both
 * their uploaded payslips (Ireland manual overrides) and their
 * published auto-generated payslips (Payroll now runs company-wide),
 * so View/Download works the same everywhere. Ownership is enforced by
 * always scoping to req.user.sub regardless of query params.
 */
payslipsRouter.get("/me", async (req, res) => {
  const user = await db.selectFrom("User").selectAll().where("id", "=", req.user!.sub).executeTakeFirst();
  if (!user) return res.status(404).json({ error: "User not found" });

  const [uploaded, generated] = await Promise.all([
    db.selectFrom("PayslipIreland").selectAll().where("userId", "=", user.id).orderBy("period", "desc").execute(),
    db
      .selectFrom("GeneratedPayslip")
      .selectAll()
      .where("userId", "=", user.id)
      .where("status", "=", "PUBLISHED")
      .orderBy("period", "desc")
      .execute(),
  ]);
  res.json({ uploaded, generated });
});

/** GET /payslips/ireland/:id/file — signed URL, ownership-checked, audit-logged view. */
payslipsRouter.get("/ireland/:id/file", async (req, res) => {
  const payslip = await db.selectFrom("PayslipIreland").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!payslip) return res.status(404).json({ error: "Payslip not found" });
  const isElevated = req.user!.role === "ADMIN";
  if (payslip.userId !== req.user!.sub && !isElevated) {
    return res.status(403).json({ error: "You can only view your own payslips" });
  }
  const fileUrl = await getStorageAdapter().getSignedUrl(payslip.fileKey);
  await writeAuditLog({ userId: req.user!.sub, action: "PayslipViewed", targetId: payslip.id });
  res.json({ fileUrl });
});

payslipsRouter.get("/ph/:id/file", async (req, res) => {
  const payslip = await db.selectFrom("GeneratedPayslip").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!payslip || !payslip.fileKey) return res.status(404).json({ error: "Payslip not found" });
  const isElevated = req.user!.role === "ADMIN";
  if (payslip.userId !== req.user!.sub && !isElevated) {
    return res.status(403).json({ error: "You can only view your own payslips" });
  }
  const fileUrl = await getStorageAdapter().getSignedUrl(payslip.fileKey);
  await writeAuditLog({ userId: req.user!.sub, action: "PayslipViewed", targetId: payslip.id });
  res.json({ fileUrl });
});

const uploadSchema = z.object({ userId: z.string(), period: z.string() });

/** POST /payslips/ireland/upload — Admin uploads a PDF per employee per period. */
payslipsRouter.post("/ireland/upload", allow("ADMIN"), upload.single("file"), async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "userId and period are required" });
  if (!req.file) return res.status(400).json({ error: "A payslip PDF upload is required" });

  const fileKey = `payslips-ie/${parsed.data.userId}/${parsed.data.period}.pdf`;
  await getStorageAdapter().putObject(fileKey, req.file.buffer, "application/pdf");

  // One payslip per employee per month: uploading again replaces the earlier
  // one (and repairs an entry whose file has gone missing) instead of adding a duplicate.
  const existing = await db
    .selectFrom("PayslipIreland")
    .select("id")
    .where("userId", "=", parsed.data.userId)
    .where("period", "=", parsed.data.period)
    .executeTakeFirst();
  const payslip = existing
    ? await db
        .updateTable("PayslipIreland")
        .set({ fileKey, uploadedBy: req.user!.sub, uploadedAt: new Date() })
        .where("id", "=", existing.id)
        .returningAll()
        .executeTakeFirstOrThrow()
    : await db
        .insertInto("PayslipIreland")
        .values({ userId: parsed.data.userId, period: parsed.data.period, fileKey, uploadedBy: req.user!.sub })
        .returningAll()
        .executeTakeFirstOrThrow();
  await writeAuditLog({ userId: req.user!.sub, action: "PayslipUploaded", targetId: payslip.id });
  res.status(201).json({ payslip });
});

/** GET /payslips/team — Admin only (Section 3: team payslips not visible to Manager by default). */
payslipsRouter.get("/team", allow("ADMIN"), async (_req, res) => {
  const [ireland, ph] = await Promise.all([
    db.selectFrom("PayslipIreland").selectAll().orderBy("period", "desc").execute(),
    db.selectFrom("GeneratedPayslip").selectAll().orderBy("period", "desc").execute(),
  ]);
  res.json({ ireland, philippines: ph });
});

/**
 * GET /payslips/all — Admin-only: every published/uploaded payslip for
 * every user, for the Payslips tab (revision: "List of ALL Generated
 * payslips for all Users" — Admin sees everything; Employee/Manager
 * stay scoped to their own via GET /payslips/me).
 */
payslipsRouter.get("/all", allow("ADMIN"), async (_req, res) => {
  const [uploaded, generated] = await Promise.all([
    db.selectFrom("PayslipIreland").selectAll().orderBy("period", "desc").execute(),
    db.selectFrom("GeneratedPayslip").selectAll().where("status", "=", "PUBLISHED").orderBy("period", "desc").execute(),
  ]);
  const userIds = [...new Set([...uploaded.map((p) => p.userId), ...generated.map((p) => p.userId)])];
  const users = userIds.length ? await db.selectFrom("User").select(["id", "name", "email", "country"]).where("id", "in", userIds).execute() : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  res.json({
    uploaded: uploaded.map((p) => ({ ...p, user: byId.get(p.userId) ?? null })),
    generated: generated.map((p) => ({ ...p, user: byId.get(p.userId) ?? null })),
  });
});

/** DELETE /payslips/ireland/:id — Admin removes an uploaded payslip (Payslips: "Delete Option"). */
payslipsRouter.delete("/ireland/:id", allow("ADMIN"), async (req, res) => {
  await db.deleteFrom("PayslipIreland").where("id", "=", req.params.id).execute();
  await writeAuditLog({ userId: req.user!.sub, action: "PayslipDeleted", targetId: req.params.id });
  res.json({ ok: true });
});

/** DELETE /payslips/ph/:id — Admin removes a generated payslip. */
payslipsRouter.delete("/ph/:id", allow("ADMIN"), async (req, res) => {
  await db.deleteFrom("GeneratedPayslip").where("id", "=", req.params.id).execute();
  await writeAuditLog({ userId: req.user!.sub, action: "PayslipDeleted", targetId: req.params.id });
  res.json({ ok: true });
});
