-- Task assignment: a Manager/Admin assigns a task (subject, note, link) to an
-- employee for a given date. It shows on the employee's calendar, and the
-- employee moves it through In Progress -> For Review -> Done.
CREATE TABLE "Task" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "subject" TEXT NOT NULL,
  "note" TEXT,
  "link" TEXT,
  "assigneeId" UUID NOT NULL REFERENCES "User"("id"),
  "assignedBy" UUID NOT NULL REFERENCES "User"("id"),
  "dueDate" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ASSIGNED' CHECK ("status" IN ('ASSIGNED', 'IN_PROGRESS', 'FOR_REVIEW', 'DONE')),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "Task_assigneeId_dueDate_idx" ON "Task"("assigneeId", "dueDate");
CREATE INDEX "Task_assignedBy_idx" ON "Task"("assignedBy");
