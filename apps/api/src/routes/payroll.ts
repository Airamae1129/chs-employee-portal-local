import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { allow } from "../middleware/rbac";
import { writeAuditLog } from "../utils/audit";
import { getStorageAdapter } from "../utils/storage";
import { renderPayslipPdf } from "../utils/payslipPdf";
import { countWeekdaysInMonth, weekdayDatesInMonth } from "../utils/time";
import { paidLeaveDayStatusForYear } from "../utils/leave";

/**
 * Payroll revision: real working-days-based calculation, run
 * company-wide (every active employee with a SalaryConfig, any
 * country) instead of Philippines-only, 100% income with no tax,
 * holiday/leave-aware attendance, and a real "Professional Fees" PDF
 * per employee per period. Admin-only (Payroll nav item).
 *
 * Attendance for each Mon-Fri date in the period, in priority order:
 *   1. Holiday in the employee's own country OR Ireland (company-wide
 *      per the revision) -> paid, no clock-in required.
 *   2. Approved PAID leave, within the first 12 paid-leave weekdays
 *      used in the calendar year -> paid ("Leave Used").
 *   3. Any other approved leave (UNPAID, or PAID beyond the 12-day cap)
 *      -> unpaid, counts as an absence for pay purposes.
 *   4. At least one clock-IN that day -> a full paid day (hours beyond
 *      8/day are logged accurately but never increase pay — "no OT").
 *   5. Otherwise -> absence, that day is not paid.
 */
export const payrollRouter = Router();
payrollRouter.use(requireAuth, allow("ADMIN"));

async function unpaidLeaveDatesInRange(employeeId: string, from: string, to: string): Promise<Set<string>> {
  const requests = await db
    .selectFrom("HRRequest")
    .selectAll()
    .where("employeeId", "=", employeeId)
    .where("requestType", "=", "LEAVE")
    .where("status", "=", "APPROVED")
    .where("payType", "=", "UNPAID")
    .where("startDate", "<=", to)
    .where("endDate", ">=", from)
    .execute();
  const dates = new Set<string>();
  for (const r of requests) {
    if (!r.startDate || !r.endDate) continue;
    let d = new Date(`${r.startDate}T00:00:00.000Z`);
    const end = new Date(`${r.endDate}T00:00:00.000Z`);
    while (d <= end) {
      dates.add(d.toISOString().slice(0, 10));
      d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    }
  }
  return dates;
}

function computeHours(events: { eventType: string; timestamp: Date | string }[]): number {
  let total = 0;
  let lastIn: Date | null = null;
  for (const e of [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())) {
    const ts = new Date(e.timestamp);
    if (e.eventType === "IN") lastIn = ts;
    else if (e.eventType === "OUT" && lastIn) {
      total += (ts.getTime() - lastIn.getTime()) / 3_600_000;
      lastIn = null;
    }
  }
  return total;
}

const runSchema = z.object({ period: z.string() }); // "YYYY-MM"

payrollRouter.post("/run", async (req, res) => {
  const parsed = runSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "period is required, e.g. 2026-09" });
  const { period } = parsed.data;
  const [year, month] = period.split("-").map(Number);

  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const periodStartIso = periodStart.toISOString().slice(0, 10);
  const periodEndIso = periodEnd.toISOString().slice(0, 10);
  const weekdays = weekdayDatesInMonth(year, month);
  const workingDaysInPeriod = countWeekdaysInMonth(year, month);
  const monthLabel = periodStart.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const employees = await db.selectFrom("User").selectAll().where("status", "=", "ACTIVE").execute();

  const created = [];
  for (const emp of employees) {
    const salaryConfig = await db.selectFrom("SalaryConfig").selectAll().where("userId", "=", emp.id).executeTakeFirst();
    if (!salaryConfig) continue; // can't compute pay without a salary configured

    const [ownCountryHolidays, ieHolidays, events, leaveStatus, unpaidLeaveDates] = await Promise.all([
      db.selectFrom("Holiday").select("date").where("country", "=", emp.country).where("date", ">=", periodStartIso).where("date", "<=", periodEndIso).execute(),
      db.selectFrom("Holiday").select("date").where("country", "=", "IRELAND").where("date", ">=", periodStartIso).where("date", "<=", periodEndIso).execute(),
      db.selectFrom("TimeEvent").selectAll().where("userId", "=", emp.id).where("timestamp", ">=", periodStart).where("timestamp", "<=", periodEnd).execute(),
      paidLeaveDayStatusForYear(emp.id, year),
      unpaidLeaveDatesInRange(emp.id, periodStartIso, periodEndIso),
    ]);

    const holidayDates = new Set([...ownCountryHolidays, ...ieHolidays].map((h) => h.date.slice(0, 10)));
    const workedDates = new Set<string>();
    for (const e of events) {
      if (e.eventType === "IN") workedDates.add(new Date(e.timestamp).toISOString().slice(0, 10));
    }

    let daysPaid = 0;
    let holidayDayCount = 0;
    let leaveUsedDays = 0;
    for (const date of weekdays) {
      if (holidayDates.has(date)) {
        daysPaid += 1;
        holidayDayCount += 1;
      } else if (leaveStatus.get(date) === "PAID") {
        daysPaid += 1;
        leaveUsedDays += 1;
      } else if (unpaidLeaveDates.has(date) || leaveStatus.get(date) === "UNPAID") {
        // unpaid leave or leave beyond the 12-day paid allowance: no pay, not worked either.
      } else if (workedDates.has(date)) {
        daysPaid += 1;
      }
      // else: absent, no pay for that weekday.
    }

    const totalWorkHours = Math.round(computeHours(events) * 100) / 100;
    const dailyRate =
      salaryConfig.salaryType === "MONTHLY" ? Number(salaryConfig.baseRate) / workingDaysInPeriod : Number(salaryConfig.baseRate) * 8;
    const holidayPay = Math.round(dailyRate * holidayDayCount * 100) / 100;
    const grossPay = Math.round((dailyRate * daysPaid + Number(salaryConfig.allowances)) * 100) / 100;
    const deductions = 0; // revision: "100% income, no tax"
    const netPay = grossPay - deductions;
    const currency = emp.country === "IRELAND" ? "EUR" : "PHP";

    const existing = await db
      .selectFrom("GeneratedPayslip")
      .selectAll()
      .where("userId", "=", emp.id)
      .where("period", "=", period)
      .executeTakeFirst();

    const values = {
      grossPay: String(grossPay),
      deductions: String(deductions),
      netPay: String(netPay),
      totalWorkHours: String(totalWorkHours),
      holidayPay: String(holidayPay),
      leaveUsedDays: String(leaveUsedDays),
      workingDaysInPeriod,
      daysPaid: String(daysPaid),
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

payrollRouter.patch("/:id/approve", async (req, res) => {
  const payslip = await db.updateTable("GeneratedPayslip").set({ status: "APPROVED" }).where("id", "=", req.params.id).returningAll().executeTakeFirstOrThrow();
  await writeAuditLog({ userId: req.user!.sub, action: "PayrollApproved", targetId: payslip.id });
  res.json({ payslip });
});

payrollRouter.patch("/:id/publish", async (req, res) => {
  const existing = await db.selectFrom("GeneratedPayslip").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "Payslip not found" });
  const employee = await db.selectFrom("User").selectAll().where("id", "=", existing.userId).executeTakeFirst();
  if (!employee) return res.status(404).json({ error: "Employee not found" });

  const [year, month] = existing.period.split("-").map(Number);
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const pdf = await renderPayslipPdf({
    employeeName: employee.name,
    email: employee.email,
    monthLabel,
    totalWorkHours: Number(existing.totalWorkHours),
    holidayPay: Number(existing.holidayPay),
    leaveUsedDays: Number(existing.leaveUsedDays),
    netPay: Number(existing.netPay),
    // pdf-lib's standard WinAnsi-encoded fonts can't render "₱" (only
    // Latin-1/WinAnsi glyphs are available without embedding a custom
    // Unicode font), so the PDF uses the ISO code instead — the web UI
    // still shows the real "₱" symbol since that's plain HTML text.
    currencySymbol: existing.currency === "EUR" ? "€" : "PHP ",
  });

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
