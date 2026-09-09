import { db } from "../db";
import { IE_TIME_ZONE, isoDateInZone, nextMidnightInZone } from "./time";

/**
 * Manager Timekeeping revision: Managers no longer edit employees' time
 * entries directly — instead they get an automatic weekly notification
 * run, every Saturday 00:00 Ireland time, that flags anyone with a
 * still-open (missing clock-out) session and notifies that employee.
 *
 * Implemented as a minute-tick check rather than a single long setTimeout
 * so it stays correct across Ireland's DST changes without drift, and
 * survives the dev server's file-watch restarts (tsx watch) picking the
 * check back up within a minute.
 */
let lastRunWeekKey: string | null = null;

function isSaturdayMidnightInIreland(date: Date): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: IE_TIME_ZONE, weekday: "short" }).format(date);
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone: IE_TIME_ZONE, hour: "2-digit", hour12: false }).format(date);
  return weekday === "Sat" && hour === "00";
}

async function runMissingClockOutNotificationSweep() {
  const now = new Date();
  const events = await db.selectFrom("TimeEvent").selectAll().orderBy("timestamp", "asc").execute();

  const byUser = new Map<string, typeof events>();
  for (const e of events) {
    const list = byUser.get(e.userId) ?? [];
    list.push(e);
    byUser.set(e.userId, list);
  }

  let notified = 0;
  for (const [userId, userEvents] of byUser) {
    const openSessions = userEvents.filter((e) => e.eventType === "IN");
    const missing = openSessions.filter((inEvt) => {
      const hasLaterOut = userEvents.some((e) => e.eventType === "OUT" && new Date(e.timestamp) > new Date(inEvt.timestamp));
      if (hasLaterOut) return false;
      return now > nextMidnightInZone(new Date(inEvt.timestamp), IE_TIME_ZONE);
    });
    if (missing.length === 0) continue;

    const mostRecent = missing[missing.length - 1];
    const relatedDate = isoDateInZone(new Date(mostRecent.timestamp), IE_TIME_ZONE);

    // Avoid re-notifying for the same open session within the same week.
    const alreadyNotified = await db
      .selectFrom("Notification")
      .select("id")
      .where("userId", "=", userId)
      .where("type", "=", "MISSING_CLOCK_OUT")
      .where("relatedDate", "=", relatedDate)
      .executeTakeFirst();
    if (alreadyNotified) continue;

    await db
      .insertInto("Notification")
      .values({
        userId,
        type: "MISSING_CLOCK_OUT",
        message: `You have a missing clock-out from ${relatedDate}. Please review your Timekeeping records.`,
        relatedDate,
      })
      .execute();
    notified++;
  }

  if (notified > 0) {
    console.log(`[scheduler] Weekly missing-clock-out sweep: notified ${notified} employee(s).`);
  }
}

export function startScheduler() {
  setInterval(() => {
    const now = new Date();
    if (!isSaturdayMidnightInIreland(now)) return;
    const weekKey = isoDateInZone(now, IE_TIME_ZONE);
    if (lastRunWeekKey === weekKey) return; // already ran this minute-window this week
    lastRunWeekKey = weekKey;
    runMissingClockOutNotificationSweep().catch((err) => console.error("[scheduler] sweep failed:", err));
  }, 60_000);
}

// Exported for manual/testing use (e.g. an admin "run now" action).
export { runMissingClockOutNotificationSweep };
