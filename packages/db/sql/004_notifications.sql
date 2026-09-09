-- Per-user notifications (Timekeeping revision: Manager access to the
-- automatic weekly missing-clock-out notification sent to employees,
-- Saturday 00:00 Ireland time).
CREATE TABLE "Notification" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id"),
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "relatedDate" DATE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "readAt" TIMESTAMPTZ
);
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
