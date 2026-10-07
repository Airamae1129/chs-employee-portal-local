-- Payslips use the fixed monthly salary (no attendance-based computation).
-- Each payslip keeps a copy of the salary and allowances it was generated
-- from, the working days in the month for reference, and any unpaid-leave
-- deduction the Payroll user calculated and entered by hand.
ALTER TABLE "GeneratedPayslip"
  ADD COLUMN "baseSalary" NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "allowances" NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "unpaidLeaveDays" NUMERIC(5, 1) NOT NULL DEFAULT 0,
  ADD COLUMN "deductionNote" TEXT;
