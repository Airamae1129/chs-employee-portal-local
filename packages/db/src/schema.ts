import { Generated } from "kysely";
import * as E from "./enums";

// Timestamps and dates are always constructed as real `Date`/string
// values by application code before being handed to Kysely, so plain
// types are used here rather than Kysely's ColumnType<Select,Insert,
// Update> wrapper — that wrapper is only worth the complexity when a
// column's insert/update shape genuinely differs from its select shape,
// which isn't the case for any column in this schema.
type Timestamp = Date;
type DateOnly = string; // Postgres DATE, always handled as "YYYY-MM-DD"
type Json = Record<string, unknown> | null;

export interface UserTable {
  id: Generated<string>;
  entraObjectId: string | null;
  name: string;
  email: string;
  passwordHash: string | null;
  role: E.Role;
  managerId: string | null;
  country: E.Country;
  status: Generated<E.UserStatus>;
  jobTitle: string | null;
  birthday: DateOnly | null;
  mustResetPassword: Generated<boolean>;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
}

export interface TimeEventTable {
  id: Generated<string>;
  userId: string;
  eventType: E.TimeEventType;
  timestamp: Timestamp;
  deviceId: string | null;
  notes: string | null;
  status: Generated<E.TimeEventStatus>;
  teamsMessageId: string | null;
  teamsPostError: string | null;
  createdAt: Generated<Timestamp>;
}

export interface CalendarEntryTable {
  id: Generated<string>;
  userId: string;
  date: DateOnly;
  entryType: E.CalendarEntryType;
  title: string;
  notes: string | null;
  country: E.Country | null;
  source: Generated<E.CalendarEntrySource>;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
}

export interface HolidayTable {
  id: Generated<string>;
  country: E.Country;
  date: DateOnly;
  name: string;
  type: E.HolidayType;
  year: number;
  source: Generated<E.HolidaySource>;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
}

export interface HRRequestTable {
  id: Generated<string>;
  requestType: E.HRRequestType;
  employeeId: string;
  approverId: string | null;
  status: Generated<E.HRRequestStatus>;
  submissionDate: Generated<Timestamp>;
  decisionDate: Timestamp | null;
  comments: string | null;
  startDate: DateOnly | null;
  endDate: DateOnly | null;
  leaveType: string | null;
  payType: E.LeavePayType | null;
  fileKey: string | null;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
}

export interface PolicyTable {
  id: Generated<string>;
  title: string;
  version: string;
  owner: string;
  effectiveDate: DateOnly;
  category: E.PolicyCategory;
  fileKey: string | null;
  linkUrl: string | null;
  description: string | null;
  acknowledgementRequired: Generated<boolean>;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
}

export interface PolicyAcknowledgementTable {
  id: Generated<string>;
  policyId: string;
  userId: string;
  acknowledgedAt: Generated<Timestamp>;
}

export interface ClientWorkspaceTable {
  id: Generated<string>;
  clientName: string;
  description: string | null;
  linkUrl: string | null;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
}

export interface ClientWorkspaceItemTable {
  id: Generated<string>;
  workspaceId: string;
  title: string;
  description: string | null;
  linkUrl: string;
  createdBy: string | null;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
}

export interface StoredFileTable {
  key: string;
  contentType: Generated<string>;
  data: Buffer;
  createdAt: Generated<Timestamp>;
}

export interface AnnouncementTable {
  id: Generated<string>;
  authorId: string | null;
  message: string;
  parentId: string | null;
  kind: string | null;
  refKey: string | null;
  activeDate: DateOnly | null;
  activeZone: string | null;
  createdAt: Generated<Timestamp>;
}

export interface NotificationTable {
  id: Generated<string>;
  userId: string;
  type: string;
  message: string;
  relatedDate: DateOnly | null;
  createdAt: Generated<Timestamp>;
  readAt: Timestamp | null;
}

export interface WorkspaceAccessRequestTable {
  id: Generated<string>;
  workspaceId: string;
  userId: string;
  status: Generated<E.WorkspaceAccessStatus>;
  requestedAt: Generated<Timestamp>;
  decidedById: string | null;
  decidedAt: Timestamp | null;
}

export interface ResourceAllocationTable {
  id: Generated<string>;
  userId: string;
  weekStartDate: DateOnly;
  project: string;
  allocationPercent: number;
}

export interface SalaryConfigTable {
  userId: string;
  salaryType: E.SalaryType;
  baseRate: string; // NUMERIC comes back as string from pg
  allowances: Generated<string>;
  standardWorkingDays: Generated<number>;
  currency: Generated<string>;
  updatedAt: Generated<Timestamp>;
}

export interface PayslipIrelandTable {
  id: Generated<string>;
  userId: string;
  period: string;
  fileKey: string;
  uploadedBy: string;
  uploadedAt: Generated<Timestamp>;
}

export interface GeneratedPayslipTable {
  id: Generated<string>;
  userId: string;
  period: string;
  grossPay: string;
  deductions: string;
  netPay: string;
  totalWorkHours: Generated<string>;
  holidayPay: Generated<string>;
  leaveUsedDays: Generated<string>;
  workingDaysInPeriod: Generated<number>;
  daysPaid: Generated<string>;
  currency: Generated<string>;
  status: Generated<E.GeneratedPayslipStatus>;
  version: Generated<number>;
  fileKey: string | null;
  generatedAt: Generated<Timestamp>;
  publishedAt: Timestamp | null;
}

export interface AuditLogTable {
  id: Generated<string>;
  userId: string | null;
  action: string;
  targetId: string | null;
  timestamp: Generated<Timestamp>;
  metadata: Json;
}

export interface Database {
  User: UserTable;
  TimeEvent: TimeEventTable;
  CalendarEntry: CalendarEntryTable;
  Holiday: HolidayTable;
  HRRequest: HRRequestTable;
  Policy: PolicyTable;
  PolicyAcknowledgement: PolicyAcknowledgementTable;
  ClientWorkspace: ClientWorkspaceTable;
  ClientWorkspaceItem: ClientWorkspaceItemTable;
  WorkspaceAccessRequest: WorkspaceAccessRequestTable;
  ResourceAllocation: ResourceAllocationTable;
  SalaryConfig: SalaryConfigTable;
  PayslipIreland: PayslipIrelandTable;
  GeneratedPayslip: GeneratedPayslipTable;
  AuditLog: AuditLogTable;
  Announcement: AnnouncementTable;
  Notification: NotificationTable;
  StoredFile: StoredFileTable;
}
