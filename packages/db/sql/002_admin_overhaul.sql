-- CHS Employee Portal — admin-side overhaul (Sept 2026 revision pass).
--
-- Adds: forced-password-reset flag, policy/workspace external-link
-- support with nested client-workspace items, a lightweight admin/
-- manager announcement feed for the dashboard, and the payroll
-- breakdown fields (hours/holiday pay/leave used/days paid) needed to
-- render the "Professional Fees" payslip template and drive the new
-- real-time, working-days-based payroll calculation.

-- First-login forced password reset.
ALTER TABLE "User" ADD COLUMN "mustResetPassword" BOOLEAN NOT NULL DEFAULT false;

-- Policies can now be a SharePoint-style link instead of (or alongside) an uploaded file.
ALTER TABLE "Policy" ALTER COLUMN "fileKey" DROP NOT NULL;
ALTER TABLE "Policy" ADD COLUMN "linkUrl" TEXT;

-- Client workspace "folder" no longer requires its own link — links now live on nested items.
ALTER TABLE "ClientWorkspace" ALTER COLUMN "linkUrl" DROP NOT NULL;

CREATE TABLE "ClientWorkspaceItem" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspaceId" TEXT NOT NULL REFERENCES "ClientWorkspace"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "linkUrl" TEXT NOT NULL,
  "createdBy" UUID REFERENCES "User"("id"),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "ClientWorkspaceItem_workspaceId_idx" ON "ClientWorkspaceItem"("workspaceId");

-- Dashboard "Notification from Admin/Manager" feed.
CREATE TABLE "Announcement" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "authorId" UUID NOT NULL REFERENCES "User"("id"),
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "Announcement_createdAt_idx" ON "Announcement"("createdAt");

-- New PH holiday type seen in the 2026 calendar ("Special Working Day").
ALTER TYPE "HolidayType" ADD VALUE 'SPECIAL_WORKING_DAY';

-- Payroll breakdown fields to match the "Professional Fees" payslip template
-- (Total Work Hours / Holiday Pay / Leave Used / Net Pay) and the new
-- real-time, working-days-based calculation. Generated payslips now cover
-- Ireland employees too (Run Payroll generates for every active employee),
-- so a currency column replaces the old PH-only assumption.
ALTER TABLE "GeneratedPayslip" ADD COLUMN "totalWorkHours" NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE "GeneratedPayslip" ADD COLUMN "holidayPay" NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE "GeneratedPayslip" ADD COLUMN "leaveUsedDays" NUMERIC(6, 2) NOT NULL DEFAULT 0;
ALTER TABLE "GeneratedPayslip" ADD COLUMN "workingDaysInPeriod" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GeneratedPayslip" ADD COLUMN "daysPaid" NUMERIC(6, 2) NOT NULL DEFAULT 0;
ALTER TABLE "GeneratedPayslip" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'PHP';
