import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { Kysely, PostgresDialect } from "kysely";
import { Pool, types } from "pg";
import { Database } from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __chsDb: Kysely<Database> | undefined;
}

// pg's default DATE (OID 1082) parser builds a JS Date from the
// column's local-calendar components, which then serializes to UTC ISO
// a day off whenever the server's OS timezone isn't UTC (e.g. holidays
// seeded as "2026-03-17" coming back as "2026-03-16" on a UTC+8 host).
// Every DATE column in this schema is documented and handled as a
// plain "YYYY-MM-DD" string (see DateOnly in schema.ts) — returning the
// raw string here instead of parsing it avoids that shift entirely.
types.setTypeParser(1082, (value: string) => value);

function createDb(): Kysely<Database> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

export const db = global.__chsDb ?? createDb();
if (process.env.NODE_ENV !== "production") {
  global.__chsDb = db;
}

export * from "./schema";
export * as Enums from "./enums";
export { Role, Country } from "./enums";
export type {
  Role as RoleType,
  Country as CountryType,
  UserStatus,
  TimeEventType,
  TimeEventStatus,
  CalendarEntryType,
  CalendarEntrySource,
  HolidayType,
  HolidaySource,
  HRRequestType,
  HRRequestStatus,
  LeavePayType,
  PolicyCategory,
  WorkspaceAccessStatus,
  SalaryType,
  GeneratedPayslipStatus,
} from "./enums";
