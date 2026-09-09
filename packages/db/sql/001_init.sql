-- CHS Employee Portal — initial schema.
--
-- This mirrors Section 5 ("Data Model") of the build prompt 1:1 so every
-- SharePoint List in the original PRD has a table here. Table and column
-- names intentionally match the PRD's list/field names.
--
-- NOTE ON TOOLING: this project was originally scaffolded against
-- Prisma, but Prisma's query/schema engine binaries are fetched from
-- binaries.prisma.sh at install/generate time, which is blocked by
-- egress policy in some CI/sandbox environments. To keep this scaffold
-- runnable everywhere without a native-binary dependency, the data
-- layer uses Kysely (a typed SQL query builder) directly against
-- node-postgres instead. This file is the single source of truth for
-- the schema — apply it with `npm run db:migrate` (see package.json),
-- which just runs psql against DATABASE_URL.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'MANAGER', 'ADMIN');
CREATE TYPE "Country" AS ENUM ('IRELAND', 'PHILIPPINES');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "TimeEventType" AS ENUM ('IN', 'OUT');
CREATE TYPE "TimeEventStatus" AS ENUM ('NORMAL', 'EDITED');
CREATE TYPE "CalendarEntryType" AS ENUM ('HOLIDAY', 'TASK_NOTE', 'LEAVE', 'WORK_ALLOCATION');
CREATE TYPE "CalendarEntrySource" AS ENUM ('SYSTEM', 'USER');
CREATE TYPE "HolidayType" AS ENUM ('PUBLIC_HOLIDAY', 'BANK_HOLIDAY', 'REGULAR_HOLIDAY', 'SPECIAL_NON_WORKING_DAY');
CREATE TYPE "HolidaySource" AS ENUM ('MANUAL', 'SYNCED');
CREATE TYPE "HRRequestType" AS ENUM ('LEAVE', 'COE', 'HR_LETTER', 'OTHER');
CREATE TYPE "HRRequestStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "LeavePayType" AS ENUM ('PAID', 'UNPAID');
CREATE TYPE "PolicyCategory" AS ENUM ('HR', 'IT_SECURITY', 'FINANCE', 'OPERATIONS', 'GENERAL');
CREATE TYPE "WorkspaceAccessStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED');
CREATE TYPE "SalaryType" AS ENUM ('MONTHLY', 'HOURLY');
CREATE TYPE "GeneratedPayslipStatus" AS ENUM ('DRAFT', 'HR_REVIEW', 'APPROVED', 'PUBLISHED');

CREATE TABLE "User" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "entraObjectId" TEXT UNIQUE,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT,
  "role" "Role" NOT NULL,
  "managerId" UUID REFERENCES "User"("id"),
  "country" "Country" NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "jobTitle" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "User_managerId_idx" ON "User"("managerId");
CREATE INDEX "User_role_idx" ON "User"("role");

CREATE TABLE "TimeEvent" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id"),
  "eventType" "TimeEventType" NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL,
  "deviceId" TEXT,
  "notes" TEXT,
  "status" "TimeEventStatus" NOT NULL DEFAULT 'NORMAL',
  "teamsMessageId" TEXT,
  "teamsPostError" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "TimeEvent_userId_timestamp_idx" ON "TimeEvent"("userId", "timestamp");

CREATE TABLE "CalendarEntry" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id"),
  "date" DATE NOT NULL,
  "entryType" "CalendarEntryType" NOT NULL,
  "title" TEXT NOT NULL,
  "notes" TEXT,
  "country" "Country",
  "source" "CalendarEntrySource" NOT NULL DEFAULT 'USER',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "CalendarEntry_userId_date_idx" ON "CalendarEntry"("userId", "date");

CREATE TABLE "Holiday" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "country" "Country" NOT NULL,
  "date" DATE NOT NULL,
  "name" TEXT NOT NULL,
  "type" "HolidayType" NOT NULL,
  "year" INTEGER NOT NULL,
  "source" "HolidaySource" NOT NULL DEFAULT 'MANUAL',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("country", "date")
);
CREATE INDEX "Holiday_country_year_idx" ON "Holiday"("country", "year");

CREATE TABLE "HRRequest" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "requestType" "HRRequestType" NOT NULL,
  "employeeId" UUID NOT NULL REFERENCES "User"("id"),
  "approverId" UUID REFERENCES "User"("id"),
  "status" "HRRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
  "submissionDate" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "decisionDate" TIMESTAMPTZ,
  "comments" TEXT,
  "startDate" DATE,
  "endDate" DATE,
  "leaveType" TEXT,
  "payType" "LeavePayType",
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "HRRequest_employeeId_idx" ON "HRRequest"("employeeId");
CREATE INDEX "HRRequest_approverId_idx" ON "HRRequest"("approverId");
CREATE INDEX "HRRequest_status_idx" ON "HRRequest"("status");

CREATE TABLE "Policy" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "title" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "effectiveDate" DATE NOT NULL,
  "category" "PolicyCategory" NOT NULL,
  "fileKey" TEXT NOT NULL,
  "acknowledgementRequired" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "PolicyAcknowledgement" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "policyId" TEXT NOT NULL REFERENCES "Policy"("id"),
  "userId" UUID NOT NULL REFERENCES "User"("id"),
  "acknowledgedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("policyId", "userId")
);

CREATE TABLE "ClientWorkspace" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "clientName" TEXT NOT NULL,
  "description" TEXT,
  "linkUrl" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "WorkspaceAccessRequest" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspaceId" TEXT NOT NULL REFERENCES "ClientWorkspace"("id"),
  "userId" UUID NOT NULL REFERENCES "User"("id"),
  "status" "WorkspaceAccessStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "decidedById" UUID REFERENCES "User"("id"),
  "decidedAt" TIMESTAMPTZ
);
CREATE INDEX "WorkspaceAccessRequest_workspaceId_idx" ON "WorkspaceAccessRequest"("workspaceId");
CREATE INDEX "WorkspaceAccessRequest_userId_idx" ON "WorkspaceAccessRequest"("userId");

CREATE TABLE "ResourceAllocation" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id"),
  "weekStartDate" DATE NOT NULL,
  "project" TEXT NOT NULL,
  "allocationPercent" INTEGER NOT NULL
);
CREATE INDEX "ResourceAllocation_userId_weekStartDate_idx" ON "ResourceAllocation"("userId", "weekStartDate");

CREATE TABLE "SalaryConfig" (
  "userId" UUID PRIMARY KEY REFERENCES "User"("id"),
  "salaryType" "SalaryType" NOT NULL,
  "baseRate" NUMERIC(12, 2) NOT NULL,
  "allowances" NUMERIC(12, 2) NOT NULL DEFAULT 0,
  "standardWorkingDays" INTEGER NOT NULL DEFAULT 22,
  "currency" TEXT NOT NULL DEFAULT 'PHP',
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "PayslipIreland" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id"),
  "period" TEXT NOT NULL,
  "fileKey" TEXT NOT NULL,
  "uploadedBy" UUID NOT NULL,
  "uploadedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "PayslipIreland_userId_period_idx" ON "PayslipIreland"("userId", "period");

CREATE TABLE "GeneratedPayslip" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id"),
  "period" TEXT NOT NULL,
  "grossPay" NUMERIC(12, 2) NOT NULL,
  "deductions" NUMERIC(12, 2) NOT NULL,
  "netPay" NUMERIC(12, 2) NOT NULL,
  "status" "GeneratedPayslipStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "fileKey" TEXT,
  "generatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "publishedAt" TIMESTAMPTZ
);
CREATE INDEX "GeneratedPayslip_userId_period_idx" ON "GeneratedPayslip"("userId", "period");

CREATE TABLE "AuditLog" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID REFERENCES "User"("id"),
  "action" TEXT NOT NULL,
  "targetId" TEXT,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "metadata" JSONB
);
CREATE INDEX "AuditLog_action_timestamp_idx" ON "AuditLog"("action", "timestamp");
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");
