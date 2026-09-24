/**
 * One-off data reset for the admin-panel revision pass: wipes demo
 * transactional data, replaces the 2026 holiday calendars with the
 * exact lists supplied by CHS, and replaces the seeded staff accounts
 * with the real 5-person roster. Every account gets a temporary
 * password and mustResetPassword=true (first-login forced reset).
 *
 * Run with: npm run db:reset-admin-data (from repo root).
 * Safe to re-run — it always starts from a clean slate for the tables
 * it touches.
 */
import { db } from "../src/index";
import bcrypt from "bcryptjs";

const TEMP_PASSWORD = "ChsWelcome!2026"; // shown to Admin after creation in a real flow

async function main() {
  console.log("Resetting CHS admin data (holidays + staff accounts)...");

  // Wipe transactional data that references User, then Users themselves,
  // so the roster below starts from a clean slate. Dev/demo data only.
  await db.deleteFrom("AuditLog").execute();
  await db.deleteFrom("PolicyAcknowledgement").execute();
  await db.deleteFrom("WorkspaceAccessRequest").execute();
  await db.deleteFrom("ClientWorkspaceItem").execute();
  await db.deleteFrom("ResourceAllocation").execute();
  await db.deleteFrom("PayslipIreland").execute();
  await db.deleteFrom("GeneratedPayslip").execute();
  await db.deleteFrom("SalaryConfig").execute();
  await db.deleteFrom("HRRequest").execute();
  await db.deleteFrom("CalendarEntry").execute();
  await db.deleteFrom("TimeEvent").execute();
  await db.deleteFrom("Announcement").execute();
  await db.updateTable("PolicyItem").set({ createdBy: null }).execute();
  await db.deleteFrom("User").execute();

  const passwordHash = await bcrypt.hash(TEMP_PASSWORD, 10);

  async function createUser(input: {
    name: string;
    email: string;
    role: "EMPLOYEE" | "MANAGER" | "ADMIN";
    country: "IRELAND" | "PHILIPPINES";
    jobTitle: string;
    managerId?: string | null;
  }) {
    return db
      .insertInto("User")
      .values({
        name: input.name,
        email: input.email.toLowerCase(),
        role: input.role,
        country: input.country,
        jobTitle: input.jobTitle,
        managerId: input.managerId ?? null,
        passwordHash,
        mustResetPassword: true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  const admin = await createUser({
    name: "Admin Test",
    email: "admin@cyberhealth.ie",
    role: "ADMIN",
    country: "PHILIPPINES",
    jobTitle: "Administrator",
  });

  const rida = await createUser({
    name: "Rida Villanueva",
    email: "rida@cyberhealth.ie",
    role: "MANAGER",
    country: "IRELAND",
    jobTitle: "Manager",
    managerId: admin.id,
  });

  const honeylyn = await createUser({
    name: "Honeylyn Francisco",
    email: "honeylyn@cyberhealth.ie",
    role: "MANAGER",
    country: "IRELAND",
    jobTitle: "Manager",
    managerId: admin.id,
  });

  await createUser({
    name: "Aira Mae Bugay",
    email: "aira@cyberhealth.ie",
    role: "EMPLOYEE",
    country: "PHILIPPINES",
    jobTitle: "Employee",
    managerId: honeylyn.id,
  });

  await createUser({
    name: "Camil Guiza",
    email: "camil@cyberhealth.ie",
    role: "EMPLOYEE",
    country: "PHILIPPINES",
    jobTitle: "Employee",
    managerId: rida.id,
  });

  // --- Holidays: replace whatever's there for 2026 with the exact lists given. ---
  await db.deleteFrom("Holiday").where("year", "=", 2026).execute();

  const irelandHolidays: { date: string; name: string }[] = [
    { date: "2026-01-01", name: "New Year's Day" },
    { date: "2026-02-02", name: "St. Brigid's Day" },
    { date: "2026-03-17", name: "St. Patrick's Day" },
    { date: "2026-04-06", name: "Easter Monday" },
    { date: "2026-05-04", name: "May Day" },
    { date: "2026-06-01", name: "June Bank Holiday" },
    { date: "2026-08-03", name: "August Bank Holiday" },
    { date: "2026-10-26", name: "October Bank Holiday" },
    { date: "2026-12-25", name: "Christmas Day" },
    { date: "2026-12-26", name: "St. Stephen's Day" },
  ];
  for (const h of irelandHolidays) {
    await db
      .insertInto("Holiday")
      .values({ country: "IRELAND", date: h.date, name: h.name, type: "PUBLIC_HOLIDAY", year: 2026 })
      .execute();
  }

  const phHolidays: { date: string; name: string; type: "REGULAR_HOLIDAY" | "SPECIAL_NON_WORKING_DAY" | "SPECIAL_WORKING_DAY" }[] = [
    { date: "2026-01-01", name: "New Year's Day", type: "REGULAR_HOLIDAY" },
    { date: "2026-02-17", name: "Chinese New Year", type: "SPECIAL_NON_WORKING_DAY" },
    { date: "2026-02-25", name: "EDSA People Power Revolution Anniversary", type: "SPECIAL_WORKING_DAY" },
    { date: "2026-04-02", name: "Maundy Thursday", type: "REGULAR_HOLIDAY" },
    { date: "2026-04-03", name: "Good Friday", type: "REGULAR_HOLIDAY" },
    { date: "2026-04-04", name: "Black Saturday", type: "SPECIAL_NON_WORKING_DAY" },
    { date: "2026-04-09", name: "Araw ng Kagitingan", type: "REGULAR_HOLIDAY" },
    { date: "2026-05-01", name: "Labor Day", type: "REGULAR_HOLIDAY" },
    { date: "2026-06-12", name: "Independence Day", type: "REGULAR_HOLIDAY" },
    { date: "2026-08-21", name: "Ninoy Aquino Day", type: "SPECIAL_NON_WORKING_DAY" },
    { date: "2026-08-31", name: "National Heroes Day", type: "REGULAR_HOLIDAY" },
    { date: "2026-11-01", name: "All Saints' Day", type: "SPECIAL_NON_WORKING_DAY" },
    { date: "2026-11-02", name: "All Souls' Day", type: "SPECIAL_NON_WORKING_DAY" },
    { date: "2026-11-30", name: "Bonifacio Day", type: "REGULAR_HOLIDAY" },
    { date: "2026-12-08", name: "Feast of the Immaculate Conception of Mary", type: "SPECIAL_NON_WORKING_DAY" },
    { date: "2026-12-24", name: "Christmas Eve", type: "SPECIAL_NON_WORKING_DAY" },
    { date: "2026-12-25", name: "Christmas Day", type: "REGULAR_HOLIDAY" },
    { date: "2026-12-30", name: "Rizal Day", type: "REGULAR_HOLIDAY" },
    { date: "2026-12-31", name: "Last Day of the Year", type: "SPECIAL_NON_WORKING_DAY" },
  ];
  for (const h of phHolidays) {
    await db
      .insertInto("Holiday")
      .values({ country: "PHILIPPINES", date: h.date, name: h.name, type: h.type, year: 2026 })
      .execute();
  }

  console.log("Reset complete.");
  console.log("----------------------------------------------------");
  console.log(`Temporary password for every account: ${TEMP_PASSWORD}`);
  console.log("Each account must set a new password on first login.");
  console.log("  admin@cyberhealth.ie      Admin Test (Admin, PH)");
  console.log("  rida@cyberhealth.ie       Rida Villanueva (Manager, IE)");
  console.log("  honeylyn@cyberhealth.ie   Honeylyn Francisco (Manager, IE)");
  console.log("  aira@cyberhealth.ie       Aira Mae Bugay (Employee, PH)");
  console.log("  camil@cyberhealth.ie      Camil Guiza (Employee, PH)");
  console.log("----------------------------------------------------");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.destroy();
  });
