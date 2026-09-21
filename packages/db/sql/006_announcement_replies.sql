-- Announcements: any role can post, and anyone can reply to an announcement.
-- A reply is just an Announcement row pointing at its parent (one level deep);
-- deleting the parent removes its replies.
ALTER TABLE "Announcement" ADD COLUMN "parentId" UUID REFERENCES "Announcement"("id") ON DELETE CASCADE;
CREATE INDEX "Announcement_parentId_idx" ON "Announcement"("parentId");
