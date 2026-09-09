import { db } from "../db";

/** Staff Accounts / Payroll revision: 12 paid leave days per calendar year, per employee. */
export const PAID_LEAVE_DAYS_PER_YEAR = 12;

/**
 * Expands every APPROVED, PAID leave request for `employeeId` in `year`
 * into individual Mon-Fri dates, in submission order, and marks the
 * first PAID_LEAVE_DAYS_PER_YEAR of them "PAID" and the rest "UNPAID"
 * (exceeding the allowance). Shared by Payroll (attendance/pay per day)
 * and the leave-balance display (Dashboard, HR Requests).
 */
export async function paidLeaveDayStatusForYear(employeeId: string, year: number): Promise<Map<string, "PAID" | "UNPAID">> {
  const requests = await db
    .selectFrom("HRRequest")
    .selectAll()
    .where("employeeId", "=", employeeId)
    .where("requestType", "=", "LEAVE")
    .where("status", "=", "APPROVED")
    .where("payType", "=", "PAID")
    .where("startDate", "is not", null)
    .where("endDate", "is not", null)
    .execute();

  const dates: string[] = [];
  for (const r of requests) {
    if (!r.startDate || !r.endDate) continue;
    let d = new Date(`${r.startDate}T00:00:00.000Z`);
    const end = new Date(`${r.endDate}T00:00:00.000Z`);
    while (d <= end) {
      if (d.getUTCFullYear() === year) {
        const dow = d.getUTCDay();
        if (dow !== 0 && dow !== 6) dates.push(d.toISOString().slice(0, 10));
      }
      d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    }
  }
  dates.sort();
  const status = new Map<string, "PAID" | "UNPAID">();
  dates.forEach((date, i) => status.set(date, i < PAID_LEAVE_DAYS_PER_YEAR ? "PAID" : "UNPAID"));
  return status;
}

export interface LeaveBalance {
  year: number;
  total: number;
  used: number;
  remaining: number;
}

/** Paid leave days used/remaining this year — reduces only once a leave request is APPROVED. */
export async function computeLeaveBalance(employeeId: string, year: number = new Date().getFullYear()): Promise<LeaveBalance> {
  const status = await paidLeaveDayStatusForYear(employeeId, year);
  const used = [...status.values()].filter((s) => s === "PAID").length;
  return { year, total: PAID_LEAVE_DAYS_PER_YEAR, used, remaining: Math.max(0, PAID_LEAVE_DAYS_PER_YEAR - used) };
}
