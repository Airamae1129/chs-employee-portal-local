// Mirrors the Postgres ENUM types created in sql/001_init.sql. Kept as
// plain TS union types (not a runtime enum) since Kysely just needs the
// string literal type for column typing — the Postgres ENUM does the
// actual constraint enforcement at the DB layer.

export type Role = "EMPLOYEE" | "MANAGER" | "ADMIN";
export type Country = "IRELAND" | "PHILIPPINES";
export type UserStatus = "ACTIVE" | "INACTIVE";
export type TimeEventType = "IN" | "OUT";
export type TimeEventStatus = "NORMAL" | "EDITED";
export type CalendarEntryType = "HOLIDAY" | "TASK_NOTE" | "LEAVE" | "WORK_ALLOCATION";
export type CalendarEntrySource = "SYSTEM" | "USER";
export type HolidayType = "PUBLIC_HOLIDAY" | "BANK_HOLIDAY" | "REGULAR_HOLIDAY" | "SPECIAL_NON_WORKING_DAY" | "SPECIAL_WORKING_DAY";
export type HolidaySource = "MANUAL" | "SYNCED";
export type HRRequestType = "LEAVE" | "COE" | "HR_LETTER" | "OTHER";
export type HRRequestStatus = "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED";
export type LeavePayType = "PAID" | "UNPAID";
export type PolicyCategory = "HR" | "IT_SECURITY" | "FINANCE" | "OPERATIONS" | "GENERAL";
export type WorkspaceAccessStatus = "REQUESTED" | "APPROVED" | "REJECTED";
export type SalaryType = "MONTHLY" | "HOURLY";
export type GeneratedPayslipStatus = "DRAFT" | "HR_REVIEW" | "APPROVED" | "PUBLISHED";

export const Role = { EMPLOYEE: "EMPLOYEE", MANAGER: "MANAGER", ADMIN: "ADMIN" } as const;
export const Country = { IRELAND: "IRELAND", PHILIPPINES: "PHILIPPINES" } as const;
