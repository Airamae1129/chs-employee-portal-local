-- Client Workspaces: each client folder can hold uploaded files as well as links.
ALTER TABLE "ClientWorkspaceItem" ALTER COLUMN "linkUrl" DROP NOT NULL;
ALTER TABLE "ClientWorkspaceItem" ADD COLUMN "fileKey" TEXT;
ALTER TABLE "ClientWorkspaceItem" ADD CONSTRAINT "ClientWorkspaceItem_link_or_file" CHECK ("linkUrl" IS NOT NULL OR "fileKey" IS NOT NULL);
