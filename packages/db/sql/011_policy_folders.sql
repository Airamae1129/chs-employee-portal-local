-- Policies & Templates: every policy title is its own folder that holds any
-- number of documents (a link or an uploaded file), like Client Workspaces.
CREATE TABLE "PolicyItem" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "policyId" TEXT NOT NULL REFERENCES "Policy"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "linkUrl" TEXT,
  "fileKey" TEXT,
  "createdBy" UUID REFERENCES "User"("id"),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "PolicyItem_link_or_file" CHECK ("linkUrl" IS NOT NULL OR "fileKey" IS NOT NULL)
);
CREATE INDEX "PolicyItem_policyId_idx" ON "PolicyItem"("policyId");

-- Each existing policy's single document moves into its own folder as the first item.
INSERT INTO "PolicyItem" ("policyId", "title", "description", "linkUrl", "fileKey")
SELECT "id", "title", "description", "linkUrl", "fileKey"
FROM "Policy"
WHERE "linkUrl" IS NOT NULL OR "fileKey" IS NOT NULL;
