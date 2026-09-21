import { db } from "../db";
import { IE_TIME_ZONE, PH_TIME_ZONE, isoDateInZone } from "./time";

/**
 * Automatic dashboard announcements: a birthday greeting on each active
 * employee's birthday and a note for every holiday happening today. Each
 * country is checked against its own local date (Ireland / Philippines),
 * and every post carries a unique refKey so re-running the sweep — every
 * minute, on startup, or when the feed is opened — never duplicates one.
 */
const COUNTRIES = [
  { country: "IRELAND" as const, zone: IE_TIME_ZONE, label: "Ireland" },
  { country: "PHILIPPINES" as const, zone: PH_TIME_ZONE, label: "Philippines" },
];

function isLeapYear(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

async function postOnce(kind: "BIRTHDAY" | "HOLIDAY", refKey: string, message: string, activeDate: string, activeZone: string) {
  const res = await db
    .insertInto("Announcement")
    .values({ authorId: null, message, kind, refKey, activeDate, activeZone })
    .onConflict((oc) => oc.doNothing())
    .executeTakeFirst();
  return Number(res.numInsertedOrUpdatedRows ?? 0) > 0;
}

export async function runAutoAnnouncementSweep(now = new Date()) {
  let posted = 0;

  for (const { country, zone, label } of COUNTRIES) {
    const today = isoDateInZone(now, zone); // YYYY-MM-DD in that country
    const [year, month, day] = today.split("-").map(Number);

    const holidays = await db.selectFrom("Holiday").select(["id", "name"]).where("country", "=", country).where("date", "=", today).execute();
    for (const h of holidays) {
      if (await postOnce("HOLIDAY", `HOLIDAY:${h.id}:${today}`, `🎉 Today is ${h.name} — ${label} holiday.`, today, zone)) posted++;
    }

    const people = await db
      .selectFrom("User")
      .select(["id", "name", "birthday"])
      .where("status", "=", "ACTIVE")
      .where("country", "=", country)
      .where("birthday", "is not", null)
      .execute();
    for (const p of people) {
      const bMonth = Number(p.birthday!.slice(5, 7));
      const bDay = Number(p.birthday!.slice(8, 10));
      // Feb 29 birthdays are greeted on Feb 28 in non-leap years.
      const isToday = bMonth === month && (bDay === day || (bMonth === 2 && bDay === 29 && day === 28 && !isLeapYear(year)));
      if (!isToday) continue;
      const msg = `🎂 Happy Birthday @${p.name}! Wishing you a wonderful day from all of us at CHS. 🎉`;
      if (await postOnce("BIRTHDAY", `BIRTHDAY:${p.id}:${year}`, msg, today, zone)) posted++;
    }
  }

  if (posted > 0) console.log(`[auto-announcements] posted ${posted} announcement(s).`);
  return posted;
}

let lastLazySweep = 0;
/** Cheap, throttled sweep used when the feed is opened (covers a sleeping/just-woken server). */
export async function runAutoAnnouncementSweepThrottled() {
  if (Date.now() - lastLazySweep < 60_000) return;
  lastLazySweep = Date.now();
  await runAutoAnnouncementSweep().catch((err) => console.error("[auto-announcements] sweep failed:", err));
}
