import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { allow } from "../middleware/rbac";
import { writeAuditLog } from "../utils/audit";
import { getStorageAdapter } from "../utils/storage";
import { renderGeneratedPayslip } from "../utils/generatedPayslip";
import { countWeekdaysInMonth } from "../utils/time";

/**
 * Payroll — Payroll role only (roles table: Payroll is a separate role
 * from Admin); it also owns everyone's salary settings.
 *
 * Payslips carry the fixed monthly salary — there's no attendance- or
 * hours-based computation. Each payslip records the salary and allowances
 * it was generated from and the number of working days (Mon-Fri) in the
 * month, for reference. Unpaid leave is the only deduction, and the
 * Payroll user calculates and enters it by hand (PATCH /:id/deduction):
 *
 *   net pay = monthly salary + allowances - unpaid leave deduction
 *
 * A "Professional Fees" PDF is produced per employee per period.
 */
export const payrollRouter = Router();
payrollRouter.use(requireAuth, allow("PAYROLL"));

/**
 * GET /payroll/staff — active staff with their salary settings, for the
 * Payroll page. Viewing other people's salaries is audit-logged.
 */
payrollRouter.get("/staff", async (req, res) => {
  const users = await db
    .selectFrom("User")
    .select(["id", "name", "email", "country", "role", "jobTitle"])
    .where("status", "=", "ACTIVE")
    .orderBy("name", "asc")
    .execute();
  const salaries = await db.selectFrom("SalaryConfig").select(["userId", "salaryType", "baseRate", "allowances", "currency"]).execute();
  const byUser = new Map(salaries.map((s) => [s.userId, s]));
  await writeAuditLog({ userId: req.user!.sub, action: "SalariesViewed", metadata: { count: salaries.length } });
  res.json({
    users: users.map((u) => {
      const s = byUser.get(u.id);
      return { ...u, salary: s?.baseRate ?? null, salaryType: s?.salaryType ?? null, allowances: s?.allowances ?? null, salaryCurrency: s?.currency ?? null };
    }),
  });
});

const salarySchema = z.object({
  salary: z.coerce.number().positive(),
  allowances: z.coerce.number().min(0).optional(),
});

/** PUT /payroll/salary/:userId — set or change someone's monthly salary (never your own). */
payrollRouter.put("/salary/:userId", async (req, res) => {
  const parsed = salarySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a salary greater than 0" });
  if (req.params.userId === req.user!.sub) {
    return res.status(403).json({ error: "You can't set your own salary — another Payroll user has to." });
  }
  const user = await db.selectFrom("User").select(["id", "country"]).where("id", "=", req.params.userId).executeTakeFirst();
  if (!user) return res.status(404).json({ error: "User not found" });

  const now = new Date();
  const standardWorkingDays = countWeekdaysInMonth(now.getFullYear(), now.getMonth() + 1);
  const currency = user.country === "IRELAND" ? "EUR" : "PHP";
  const existing = await db.selectFrom("SalaryConfig").selectAll().where("userId", "=", user.id).executeTakeFirst();
  const values = {
    baseRate: String(parsed.data.salary),
    ...(parsed.data.allowances !== undefined ? { allowances: String(parsed.data.allowances) } : {}),
    standardWorkingDays,
    currency,
  };
  if (existing) {
    await db.updateTable("SalaryConfig").set({ ...values, updatedAt: now }).where("userId", "=", user.id).execute();
  } else {
    await db.insertInto("SalaryConfig").values({ userId: user.id, salaryType: "MONTHLY", ...values }).execute();
  }
  await writeAuditLog({
    userId: req.user!.sub,
    action: "SalaryUpdated",
    targetId: user.id,
    metadata: {
      from: existing ? { salary: existing.baseRate, allowances: existing.allowances } : null,
      to: { salary: values.baseRate, allowances: values.allowances ?? existing?.allowances ?? "0" },
      currency,
    },
  });
  res.json({ ok: true });
});

const runSchema = z.object({ period: z.string() }); // "YYYY-MM"

payrollRouter.post("/run", async (req, res) => {
  const parsed = runSchema.safeParse(req.body);
  if (!parsed.success || !/^\d{4}-\d{2}$/.test(parsed.data.period)) {
    return res.status(400).json({ error: "period is required, e.g. 2026-09" });
  }
  const { period } = parsed.data;
  const [year, month] = period.split("-").map(Number);
  const workingDaysInPeriod = countWeekdaysInMonth(year, month);
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const employees = await db.selectFrom("User").select(["id", "name", "country"]).where("status", "=", "ACTIVE").execute();

  const created = [];
  for (const emp of employees) {
    const salaryConfig = await db.selectFrom("SalaryConfig").selectAll().where("userId", "=", emp.id).executeTakeFirst();
    if (!salaryConfig) continue; // no salary set yet — nothing to pay

    const baseSalary = Number(salaryConfig.baseRate);
    const allowances = Number(salaryConfig.allowances);
    const grossPay = round2(baseSalary + allowances);
    const currency = emp.country === "IRELAND" ? "EUR" : "PHP";

    const existing = await db
      .selectFrom("GeneratedPayslip")
      .selectAll()
      .where("userId", "=", emp.id)
      .where("period", "=", period)
      .executeTakeFirst();
    // A re-run refreshes the salary but keeps the deduction Payroll entered.
    const deductions = existing ? Number(existing.deductions) : 0;

    const values = {
      baseSalary: String(baseSalary),
      allowances: String(allowances),
      grossPay: String(grossPay),
      deductions: String(deductions),
      netPay: String(round2(grossPay - deductions)),
      workingDaysInPeriod,
      daysPaid: String(workingDaysInPeriod),
      // Attendance-based fields are no longer used for pay.
      totalWorkHours: "0",
      holidayPay: "0",
      leaveUsedDays: "0",
      currency,
    };

    const payslip = existing
      ? await db
          .updateTable("GeneratedPayslip")
          // Re-running clears any previous publish — the old PDF no longer
          // matches these numbers until it's approved and published again.
          .set({ ...values, status: "DRAFT", version: existing.version + 1, fileKey: null, publishedAt: null })
          .where("id", "=", existing.id)
          .returningAll()
          .executeTakeFirstOrThrow()
      : await db.insertInto("GeneratedPayslip").values({ userId: emp.id, period, status: "DRAFT", ...values }).returningAll().executeTakeFirstOrThrow();
    created.push({ ...payslip, employeeName: emp.name, monthLabel });
  }

  await writeAuditLog({ userId: req.user!.sub, action: "PayrollRunGenerated", metadata: { period, count: created.length } });
  res.status(201).json({ payslips: created });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const deductionSchema = z.object({
  unpaidLeaveDays: z.coerce.number().min(0).max(31),
  amount: z.coerce.number().min(0),
  note: z.string().trim().max(300).optional(),
});

/**
 * PATCH /payroll/:id/deduction — the unpaid-leave deduction, calculated
 * and entered by the Payroll user. Only before publishing; changing an
 * approved payslip sends it back to Draft for re-approval. Not on your
 * own payslip.
 */
payrollRouter.patch("/:id/deduction", async (req, res) => {
  const parsed = deductionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter the unpaid leave days and the deduction amount (0 or more)" });
  const existing = await db.selectFrom("GeneratedPayslip").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "Payslip not found" });
  if (existing.userId === req.user!.sub) {
    return res.status(403).json({ error: "You can't adjust your own payslip — another Payroll user has to." });
  }
  if (existing.status === "PUBLISHED") {
    return res.status(400).json({ error: "This payslip is already published. Re-run payroll for the period to change it." });
  }
  const gross = Number(existing.grossPay);
  if (parsed.data.amount > gross) return res.status(400).json({ error: "The deduction can't be more than the gross pay" });

  const payslip = await db
    .updateTable("GeneratedPayslip")
    .set({
      unpaidLeaveDays: String(parsed.data.unpaidLeaveDays),
      deductions: String(round2(parsed.data.amount)),
      netPay: String(round2(gross - parsed.data.amount)),
      deductionNote: parsed.data.note || null,
      status: "DRAFT",
    })
    .where("id", "=", existing.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({
    userId: req.user!.sub,
    action: "PayrollDeductionSet",
    targetId: payslip.id,
    metadata: {
      forUserId: existing.userId,
      period: existing.period,
      from: { unpaidLeaveDays: existing.unpaidLeaveDays, amount: existing.deductions },
      to: { unpaidLeaveDays: payslip.unpaidLeaveDays, amount: payslip.deductions },
      note: payslip.deductionNote,
    },
  });
  res.json({ payslip });
});

payrollRouter.patch("/:id/approve", async (req, res) => {
  const existing = await db.selectFrom("GeneratedPayslip").select(["userId"]).where("id", "=", req.params.id).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "Payslip not found" });
  if (existing.userId === req.user!.sub) {
    return res.status(403).json({ error: "You can't approve your own payslip — another Payroll user has to." });
  }
  const payslip = await db.updateTable("GeneratedPayslip").set({ status: "APPROVED" }).where("id", "=", req.params.id).returningAll().executeTakeFirstOrThrow();
  await writeAuditLog({ userId: req.user!.sub, action: "PayrollApproved", targetId: payslip.id });
  res.json({ payslip });
});

payrollRouter.patch("/:id/publish", async (req, res) => {
  const existing = await db.selectFrom("GeneratedPayslip").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "Payslip not found" });
  const pdf = await renderGeneratedPayslip(existing);
  if (!pdf) return res.status(404).json({ error: "Employee not found" });

  const fileKey = `payslips-generated/${existing.userId}/${existing.period}-v${existing.version}.pdf`;
  await getStorageAdapter().putObject(fileKey, pdf, "application/pdf");

  const payslip = await db
    .updateTable("GeneratedPayslip")
    .set({ status: "PUBLISHED", publishedAt: new Date(), fileKey })
    .where("id", "=", existing.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ userId: req.user!.sub, action: "PayrollPublished", targetId: payslip.id });
  // TODO: notify the employee (email / Teams DM via Graph) that their payslip is ready.
  res.json({ payslip });
});

payrollRouter.delete("/:id", async (req, res) => {
  await db.deleteFrom("GeneratedPayslip").where("id", "=", req.params.id).execute();
  await writeAuditLog({ userId: req.user!.sub, action: "PayrollDeleted", targetId: req.params.id });
  res.json({ ok: true });
});

payrollRouter.get("/summary", async (req, res) => {
  const period = req.query.period as string | undefined;
  let query = db.selectFrom("GeneratedPayslip").selectAll();
  if (period) query = query.where("period", "=", period);
  const payslips = await query.execute();

  const userIds = [...new Set(payslips.map((p) => p.userId))];
  const users = userIds.length
    ? await db.selectFrom("User").select(["id", "name", "email", "country"]).where("id", "in", userIds).execute()
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  const totals = payslips.reduce(
    (acc, p) => {
      acc.headcount += 1;
      acc.grossTotal += Number(p.grossPay);
      acc.netTotal += Number(p.netPay);
      return acc;
    },
    { headcount: 0, grossTotal: 0, netTotal: 0 }
  );

  res.json({ payslips: payslips.map((p) => ({ ...p, user: byId.get(p.userId) })), totals });
});
