import { db } from "../db";
import { renderPayslipPdf } from "./payslipPdf";

/**
 * Renders the payslip PDF for a generated (payroll-run) payslip straight
 * from its database row. Used when publishing, and again as a fallback
 * when the stored PDF is gone (hosts with an ephemeral disk wipe it on
 * every restart) — the PDF is fully derived from the row, so nothing is lost.
 */
export async function renderGeneratedPayslip(payslip: {
  userId: string;
  period: string;
  totalWorkHours: string | number;
  holidayPay: string | number;
  leaveUsedDays: string | number;
  netPay: string | number;
  currency: string;
}): Promise<Buffer | null> {
  const employee = await db.selectFrom("User").select(["name", "email"]).where("id", "=", payslip.userId).executeTakeFirst();
  if (!employee) return null;

  const [year, month] = payslip.period.split("-").map(Number);
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return renderPayslipPdf({
    employeeName: employee.name,
    email: employee.email,
    monthLabel,
    totalWorkHours: Number(payslip.totalWorkHours),
    holidayPay: Number(payslip.holidayPay),
    leaveUsedDays: Number(payslip.leaveUsedDays),
    netPay: Number(payslip.netPay),
    // pdf-lib's standard WinAnsi-encoded fonts can't render "₱" (only
    // Latin-1/WinAnsi glyphs are available without embedding a custom
    // Unicode font), so the PDF uses the ISO code instead — the web UI
    // still shows the real "₱" symbol since that's plain HTML text.
    currencySymbol: payslip.currency === "EUR" ? "€" : "PHP ",
  });
}
