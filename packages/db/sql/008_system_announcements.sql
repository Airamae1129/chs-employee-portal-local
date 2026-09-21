-- Automatic announcements (birthday greetings, holiday notes): posted by the
-- server, not a person, so there is no author. "refKey" makes each one
-- idempotent (e.g. BIRTHDAY:<userId>:2026-09-25) so a sweep can never post
-- the same greeting twice.
ALTER TABLE "Announcement" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "Announcement" ADD COLUMN "kind" TEXT;
ALTER TABLE "Announcement" ADD COLUMN "refKey" TEXT;
CREATE UNIQUE INDEX "Announcement_refKey_key" ON "Announcement"("refKey") WHERE "refKey" IS NOT NULL;
