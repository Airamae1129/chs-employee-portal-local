/**
 * Seed script — creates one Admin, two Managers, and several Employees
 * across both Ireland and the Philippines, plus a year of public
 * holidays for each country, a couple of sample policies, and two
 * client workspaces. Passwords below are for local/dev password-login
 * only (ALLOW_PASSWORD_LOGIN=true) and stand in for Entra ID SSO until
 * a tenant is wired up — see .env.example.
 *
 * Run with: npm run db:seed (from repo root) after db:migrate.
 */
import { db } from "../src/index";
import bcrypt from "bcryptjs";

const DEV_PASSWORD = "ChsDev!2026"; // same for every seeded user, dev only

async function upsertUser(input: {
  name: string;
  email: string;
  role: "EMPLOYEE" | "MANAGER" | "ADMIN";
  country: "IRELAND" | "PHILIPPINES";
  jobTitle: string;
  managerId?: string | null;
  passwordHash: string;
}) {
  const existing = await db.selectFrom("User").selectAll().where("email", "=", input.email).executeTakeFirst();
  if (existing) return existing;
  return db
    .insertInto("User")
    .values({
      name: input.name,
      email: input.email,
      role: input.role,
      country: input.country,
      jobTitle: input.jobTitle,
      managerId: input.managerId ?? null,
      passwordHash: input.passwordHash,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function main() {
  console.log("Seeding CHS Employee Portal database...");
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  const admin = await upsertUser({
    name: "Aoife Byrne",
    email: "admin@cyberhealth.ie",
    role: "ADMIN",
    country: "IRELAND",
    jobTitle: "Head of People Operations",
    passwordHash,
  });

  const managerIE = await upsertUser({
    name: "Cian Murphy",
    email: "manager.ie@cyberhealth.ie",
    role: "MANAGER",
    country: "IRELAND",
    jobTitle: "Engineering Manager",
    managerId: admin.id,
    passwordHash,
  });

  const managerPH = await upsertUser({
    name: "Mika Santos",
    email: "manager.ph@cyberhealth.ie",
    role: "MANAGER",
    country: "PHILIPPINES",
    jobTitle: "Delivery Manager",
    managerId: admin.id,
    passwordHash,
  });

  const employeeSeeds = [
    { name: "Aira Delacruz", email: "aira@cyberhealth.ie", country: "PHILIPPINES" as const, managerId: managerPH.id, jobTitle: "Content Editor" },
    { name: "Liam O'Connor", email: "liam@cyberhealth.ie", country: "IRELAND" as const, managerId: managerIE.id, jobTitle: "Security Analyst" },
    { name: "Grace Fitzgerald", email: "grace@cyberhealth.ie", country: "IRELAND" as const, managerId: managerIE.id, jobTitle: "Support Engineer" },
    { name: "Jomari Reyes", email: "jomari@cyberhealth.ie", country: "PHILIPPINES" as const, managerId: managerPH.id, jobTitle: "QA Engineer" },
  ];

  const employees = [];
  for (const e of employeeSeeds) {
    employees.push(await upsertUser({ ...e, role: "EMPLOYEE", passwordHash }));
  }

  for (const emp of employees.filter((e) => e.country === "PHILIPPINES")) {
    const existing = await db.selectFrom("SalaryConfig").selectAll().where("userId", "=", emp.id).executeTakeFirst();
    if (!existing) {
      await db
        .insertInto("SalaryConfig")
        .values({
          userId: emp.id,
          salaryType: "MONTHLY",
          baseRate: "45000",
          allowances: "2000",
          standardWorkingDays: 22,
          currency: "PHP",
        })
        .execute();
    }
  }

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

  for (const h of irelandHolidays) {
    const existing = await db
      .selectFrom("Holiday")
      .selectAll()
      .where("country", "=", "IRELAND")
      .where("date", "=", h.date)
      .executeTakeFirst();
    if (!existing) {
      await db.insertInto("Holiday").values({ country: "IRELAND", date: h.date, name: h.name, type: h.type, year: 2026 }).execute();
    }
  }
  for (const h of phHolidays) {
    const existing = await db
      .selectFrom("Holiday")
      .selectAll()
      .where("country", "=", "PHILIPPINES")
      .where("date", "=", h.date)
      .executeTakeFirst();
    if (!existing) {
      await db.insertInto("Holiday").values({ country: "PHILIPPINES", date: h.date, name: h.name, type: h.type, year: 2026 }).execute();
    }
  }

  const policies = [
    { id: "seed-policy-code-of-conduct", title: "Code of Conduct", version: "v3.1", owner: "People Operations", effectiveDate: "2026-01-01", category: "HR" as const, fileKey: "policies/code-of-conduct-v3.1.pdf", acknowledgementRequired: true },
    { id: "seed-policy-info-sec", title: "Information Security Policy", version: "v2.4", owner: "IT Security", effectiveDate: "2026-03-01", category: "IT_SECURITY" as const, fileKey: "policies/infosec-policy-v2.4.pdf", acknowledgementRequired: true },
    { id: "seed-policy-leave", title: "Leave & Time Off Policy", version: "v1.6", owner: "People Operations", effectiveDate: "2025-11-01", category: "HR" as const, fileKey: "policies/leave-policy-v1.6.pdf", acknowledgementRequired: false },
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
  console.log("Seeded accounts (dev password login, all use the same password):");
  console.log(`  password: ${DEV_PASSWORD}`);
  console.log(`  admin:    admin@cyberhealth.ie`);
  console.log(`  manager:  manager.ie@cyberhealth.ie / manager.ph@cyberhealth.ie`);
  console.log(`  employee: aira@cyberhealth.ie / liam@cyberhealth.ie / grace@cyberhealth.ie / jomari@cyberhealth.ie`);
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
