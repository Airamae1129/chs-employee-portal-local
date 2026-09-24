import { Router } from "express";
import { db } from "../db";
import { getStorageAdapter, verifyLocalSignedUrl } from "../utils/storage";
import { renderGeneratedPayslip } from "../utils/generatedPayslip";

export const filesRouter = Router();

/**
 * Serves storage objects by key, gated by the HMAC-signed, expiring
 * token produced by StorageAdapter.getSignedUrl — this route is what
 * makes the local storage driver honor Section 9's "never public URLs"
 * rule. When STORAGE_DRIVER=s3, callers get a real S3 presigned URL
 * instead and never hit this route at all.
 */
filesRouter.get("/:key(*)", async (req, res) => {
  const key = req.params.key;
  const expires = parseInt(String(req.query.expires ?? "0"), 10);
  const sig = String(req.query.sig ?? "");

  if (!verifyLocalSignedUrl(key, expires, sig)) {
    return res.status(403).json({ error: "Invalid or expired file link" });
  }

  try {
    const adapter = getStorageAdapter();
    let data: Buffer;
    try {
      data = await adapter.getObject(key);
    } catch (err) {
      // Hosts with an ephemeral disk (e.g. Render's free tier) lose stored files on
      // restart. A generated payslip is fully derived from its database row, so
      // rebuild it instead of failing.
      const row = key.startsWith("payslips-generated/")
        ? await db.selectFrom("GeneratedPayslip").selectAll().where("fileKey", "=", key).executeTakeFirst()
        : undefined;
      const rebuilt = row ? await renderGeneratedPayslip(row) : null;
      if (!rebuilt) throw err;
      data = rebuilt;
      await adapter.putObject(key, rebuilt, "application/pdf").catch(() => void 0);
    }
    res.setHeader("Content-Type", "application/pdf");
    // Same signed link works for both — View renders inline, Download
    // (?download=1) forces a save-as with a friendly filename.
    if (req.query.download) {
      const filename = key.split("/").pop() ?? "payslip.pdf";
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    } else {
      res.setHeader("Content-Disposition", "inline");
    }
    res.send(data);
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});
