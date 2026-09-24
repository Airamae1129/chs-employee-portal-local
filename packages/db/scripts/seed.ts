/**
 * Seed script — wipes every existing staff account (and all data that
 * depends on them: time entries, HR requests, payslips, etc.) and
 * replaces the roster with exactly three accounts: one Admin, one
 * Manager, one Employee. Also (re)seeds a year of public holidays for
 * both countries, sample policies, and client workspaces. Passwords
 * below are for local/dev password-login only (ALLOW_PASSWORD_LOGIN=
 * true) and stand in for Entra ID SSO until a tenant is wired up — see
 * .env.example.
 *
 * Run with: npm run db:seed (from repo root) after db:migrate.
 * Safe to re-run — it always starts from a clean slate for staff data.
 */
import { db } from "../src/index";
import bcrypt from "bcryptjs";

// Temporary password only — every seeded account has mustResetPassword=true,
// so on first login they're redirected to /set-password and must choose
// their own permanent password before reaching the dashboard.
const DEV_PASSWORD = "ChsDev!2026";

async function main() {
  console.log("Seeding CHS Employee Portal database...");

  // Wipe every table that references User (children first), then Users
  // themselves, so the roster below always starts from a clean slate.
  await db.deleteFrom("Notification").execute();
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
  await db.deleteFrom("Task").execute();
  await db.deleteFrom("Announcement").execute();
  await db.updateTable("PolicyItem").set({ createdBy: null }).execute();
  await db.deleteFrom("User").execute();

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

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
    name: "Admin",
    email: "admin@cyberhealth.ie",
    role: "ADMIN",
    country: "IRELAND",
    jobTitle: "Administrator",
  });

  const manager = await createUser({
    name: "Manager",
    email: "manager@cyberhealth.ie",
    role: "MANAGER",
    country: "IRELAND",
    jobTitle: "Manager",
    managerId: admin.id,
  });

  const employee = await createUser({
    name: "Employee",
    email: "employee@cyberhealth.ie",
    role: "EMPLOYEE",
    country: "IRELAND",
    jobTitle: "Employee",
    managerId: manager.id,
  });

  await db
    .insertInto("SalaryConfig")
    .values({
      userId: employee.id,
      salaryType: "MONTHLY",
      baseRate: "50000",
      allowances: "0",
      standardWorkingDays: 22,
      currency: "EUR",
    })
    .execute();

  const irelandHolidays = [
    { date: "2026-01-01", name: "New Year's Day", type: "PUBLIC_HOLIDAY" as const },
    { date: "2026-02-02", name: "St. Brigid's Day", type: "PUBLIC_HOLIDAY" as const },
    { date: "2026-03-17", name: "St. Patrick's Day", type: "PUBLIC_HOLIDAY" as const },
    { date: "2026-04-06", name: "Easter Monday", type: "PUBLIC_HOLIDAY" as const },
    { date: "2026-05-04", name: "May Bank Holiday", type: "BANK_HOLIDAY" as const },
    { date: "2026-06-01", name: "June Bank Holiday", type: "BANK_HOLIDAY" as const },
    { date: "2026-08-03", name: "August Bank Holiday", type: "BANK_HOLIDAY" as const },
    { date: "2026-10-26", name: "October Bank Holiday", type: "BANK_HOLIDAY" as const },
    { date: "2026-12-25", name: "Christmas Day", type: "PUBLIC_HOLIDAY" as const },
    { date: "2026-12-26", name: "St. Stephen's Day", type: "PUBLIC_HOLIDAY" as const },
  ];
  const phHolidays = [
    { date: "2026-01-01", name: "New Year's Day", type: "REGULAR_HOLIDAY" as const },
    { date: "2026-04-02", name: "Maundy Thursday", type: "REGULAR_HOLIDAY" as const },
    { date: "2026-04-03", name: "Good Friday", type: "REGULAR_HOLIDAY" as const },
    { date: "2026-04-09", name: "Araw ng Kagitingan", type: "REGULAR_HOLIDAY" as const },
    { date: "2026-05-01", name: "Labor Day", type: "REGULAR_HOLIDAY" as const },
    { date: "2026-06-12", name: "Independence Day", type: "REGULAR_HOLIDAY" as const },
    { date: "2026-08-21", name: "Ninoy Aquino Day", type: "SPECIAL_NON_WORKING_DAY" as const },
    { date: "2026-08-31", name: "National Heroes Day", type: "REGULAR_HOLIDAY" as const },
    { date: "2026-11-30", name: "Bonifacio Day", type: "REGULAR_HOLIDAY" as const },
    { date: "2026-12-25", name: "Christmas Day", type: "REGULAR_HOLIDAY" as const },
    { date: "2026-12-30", name: "Rizal Day", type: "REGULAR_HOLIDAY" as const },
  ];

  await db.deleteFrom("Holiday").where("year", "=", 2026).execute();
  for (const h of irelandHolidays) {
    await db.insertInto("Holiday").values({ country: "IRELAND", date: h.date, name: h.name, type: h.type, year: 2026 }).execute();
  }
  for (const h of phHolidays) {
    await db.insertInto("Holiday").values({ country: "PHILIPPINES", date: h.date, name: h.name, type: h.type, year: 2026 }).execute();
  }

  const policies = [
    { id: "seed-policy-code-of-conduct", title: "Code of Conduct", version: "v3.1", owner: "People Operations", effectiveDate: "2026-01-01", category: "HR" as const, acknowledgementRequired: true },
    { id: "seed-policy-info-sec", title: "Information Security Policy", version: "v2.4", owner: "IT Security", effectiveDate: "2026-03-01", category: "IT_SECURITY" as const, acknowledgementRequired: true },
    { id: "seed-policy-leave", title: "Leave & Time Off Policy", version: "v1.6", owner: "People Operations", effectiveDate: "2025-11-01", category: "HR" as const, acknowledgementRequired: false },
  ];
  for (const p of policies) {
    const existing = await db.selectFrom("Policy").selectAll().where("id", "=", p.id).executeTakeFirst();
    if (!existing) await db.insertInto("Policy").values(p).execute();
  }

  const workspaces = [
    { id: "seed-workspace-acme", clientName: "Acme Health Group", description: "SOC monitoring & incident response engagement", linkUrl: "https://cyberhealth.sharepoint.com/sites/AcmeHealthGroup" },
    { id: "seed-workspace-northstar", clientName: "Northstar Clinics", description: "Annual penetration test & compliance review", linkUrl: "https://cyberhealth.sharepoint.com/sites/NorthstarClinics" },
  ];
  for (const w of workspaces) {
    const existing = await db.selectFrom("ClientWorkspace").selectAll().where("id", "=", w.id).executeTakeFirst();
    if (!existing) await db.insertInto("ClientWorkspace").values(w).execute();
  }

  console.log("Seed complete.");
  console.log("----------------------------------------------------");
  console.log("Seeded accounts — TEMPORARY password, must be changed on first login:");
  console.log(`  temporary password: ${DEV_PASSWORD}`);
  console.log(`  admin:    admin@cyberhealth.ie`);
  console.log(`  manager:  manager@cyberhealth.ie`);
  console.log(`  employee: employee@cyberhealth.ie`);
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
