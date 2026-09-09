-- HR Requests revision: Admin/Manager can upload the fulfilling document
-- (Certificate of Employment, HR Letter) for the employee to view/download.
ALTER TABLE "HRRequest" ADD COLUMN "fileKey" TEXT;
