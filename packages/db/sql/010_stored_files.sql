-- Durable copy of every uploaded file (HR documents, policies, uploaded payslips).
-- Hosts with an ephemeral disk (Render's free tier) wipe local files on restart;
-- the storage adapter writes here as well and restores from here when a file is missing.
CREATE TABLE "StoredFile" (
  "key" TEXT PRIMARY KEY,
  "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
  "data" BYTEA NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
