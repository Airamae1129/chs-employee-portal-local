-- Comments on a task: the employee, the Manager who assigned it, and Admins can
-- all discuss it. Deleting a task removes its comments.
CREATE TABLE "TaskComment" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "taskId" UUID NOT NULL REFERENCES "Task"("id") ON DELETE CASCADE,
  "authorId" UUID NOT NULL REFERENCES "User"("id"),
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "TaskComment_taskId_createdAt_idx" ON "TaskComment"("taskId", "createdAt");
