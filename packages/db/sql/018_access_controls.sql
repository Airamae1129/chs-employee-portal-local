-- Access controls from the UAT / IT audit roles table.

-- Leave allowance is per person and adjustable by Admin (default: 12 paid days a year).
-- Ten wrong passwords in a row lock sign-in.
ALTER TABLE "User"
  ADD COLUMN "leaveAllowanceDays" INTEGER NOT NULL DEFAULT 12 CHECK ("leaveAllowanceDays" BETWEEN 0 AND 365),
  ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "loginLockedUntil" TIMESTAMPTZ;

-- Staff no longer edit their own clock records. They request a correction
-- (with a reason) and someone else — their manager, or an Admin — approves
-- it; approving applies the change to TimeEvent.
CREATE TABLE "TimeCorrectionRequest" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id"),
  "action" TEXT NOT NULL CHECK ("action" IN ('ADD', 'EDIT', 'DELETE')),
  "timeEventId" UUID REFERENCES "TimeEvent"("id") ON DELETE SET NULL,
  "eventType" "TimeEventType",
  "requestedTimestamp" TIMESTAMPTZ,
  "originalTimestamp" TIMESTAMPTZ,
  "reason" TEXT NOT NULL CHECK (length(trim("reason")) > 0),
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK ("status" IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  "decidedById" UUID REFERENCES "User"("id"),
  "decidedAt" TIMESTAMPTZ,
  "decisionNote" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ("decidedById" IS NULL OR "decidedById" <> "userId")
);
CREATE INDEX "TimeCorrectionRequest_userId_createdAt_idx" ON "TimeCorrectionRequest"("userId", "createdAt");
CREATE INDEX "TimeCorrectionRequest_status_idx" ON "TimeCorrectionRequest"("status");

-- The audit log is append-only: nobody can edit or delete entries, whatever
-- tool or account they use. (TRUNCATE is left for wiping a dev database.)
CREATE OR REPLACE FUNCTION "AuditLog_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'The audit log is append-only: entries cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "AuditLog_append_only"();
