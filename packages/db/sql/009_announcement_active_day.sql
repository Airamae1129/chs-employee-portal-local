-- Automatic announcements only show on the day they apply to. "activeDate" is
-- that day (in the note's own country time zone, "activeZone"), and the feed
-- hides the note once that day has passed.
ALTER TABLE "Announcement" ADD COLUMN "activeDate" DATE;
ALTER TABLE "Announcement" ADD COLUMN "activeZone" TEXT;

-- Any automatic notes posted before this migration were created on their day.
UPDATE "Announcement"
SET "activeDate" = ("createdAt" AT TIME ZONE 'Europe/Dublin')::date, "activeZone" = 'Europe/Dublin'
WHERE "kind" IS NOT NULL AND "activeDate" IS NULL;
