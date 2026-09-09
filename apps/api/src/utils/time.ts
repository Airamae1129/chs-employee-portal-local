/**
 * Timezone-aware helpers shared by timekeeping and payroll. Ireland is
 * the reference clock for "the working day" company-wide (Staff
 * Accounts / Timekeeping revision: "follow the time in Ireland in the
 * records"; missing-clock-out is judged against Ireland midnight).
 */
export const IE_TIME_ZONE = "Europe/Dublin";
export const PH_TIME_ZONE = "Asia/Manila";

/** "YYYY-MM-DD" for `date` as observed in the given IANA zone. */
export function isoDateInZone(date: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/** UTC instant for the next local midnight, in `zone`, strictly after `date`. */
export function nextMidnightInZone(date: Date, zone: string): Date {
  const today = isoDateInZone(date, zone);
  // Walk forward hour-by-hour from `date` until the zone-local date rolls
  // over — avoids reimplementing DST-aware offset math by hand.
  let probe = new Date(date.getTime());
  for (let i = 0; i < 48; i++) {
    probe = new Date(probe.getTime() + 60 * 60 * 1000);
    if (isoDateInZone(probe, zone) !== today) {
      // probe is now on the next local day; snap back to its local midnight
      // by binary-searching within this last hour for the rollover minute.
      let lo = probe.getTime() - 60 * 60 * 1000;
      let hi = probe.getTime();
      while (hi - lo > 1000) {
        const mid = Math.floor((lo + hi) / 2);
        if (isoDateInZone(new Date(mid), zone) === today) lo = mid;
        else hi = mid;
      }
      return new Date(hi);
    }
  }
  // Fallback (should never hit): 24h later.
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}

/** True if `date` falls on a Mon-Fri weekday, as observed in `zone`. */
export function isWeekdayInZone(date: Date, zone: string): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" }).format(date);
  return !["Sat", "Sun"].includes(weekday);
}

/** Count of Mon-Fri weekdays in the given month (1-indexed month), per the calendar (not timezone-sensitive). */
export function countWeekdaysInMonth(year: number, month1to12: number): number {
  const daysInMonth = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(Date.UTC(year, month1to12 - 1, d)).getUTCDay(); // 0=Sun..6=Sat
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/** All "YYYY-MM-DD" weekday (Mon-Fri) dates in the given month. */
export function weekdayDatesInMonth(year: number, month1to12: number): string[] {
  const daysInMonth = new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  const dates: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(Date.UTC(year, month1to12 - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      dates.push(`${year}-${String(month1to12).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
  }
  return dates;
}
