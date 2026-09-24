-- Manager/Admin "Action Taken" on a task the employee sent For Review:
-- APPROVED (task is Done) or RETURNED (sent back to In Progress for rework).
ALTER TABLE "Task" ADD COLUMN "actionTaken" TEXT CHECK ("actionTaken" IN ('APPROVED', 'RETURNED'));
