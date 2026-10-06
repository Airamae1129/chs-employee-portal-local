-- New "Payroll" role (UAT / IT audit roles table): owns salaries, payroll
-- runs and everyone's payslips, separately from Admin. Kept in its own
-- migration because a newly added enum value can't be used in the same
-- transaction that adds it.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PAYROLL';
