import { Router } from "express";
import { db } from "../db";
import { getStorageAdapter, verifyLocalSignedUrl } from "../utils/storage";
import { renderGeneratedPayslip } from "../utils/generatedPayslip";

export const filesRouter = Router();

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  txt: "text/plain; charset=utf-8",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

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
    const filename = key.split("/").pop() ?? "document";
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    res.setHeader("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
    // Same signed link works for both — View renders inline, Download
    // (?download=1) forces a save-as with a friendly filename.
    if (req.query.download) {
      const safe = filename.replace(/[^\w.\-]+/g, "_");
      res.setHeader("Content-Disposition", `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    } else {
      res.setHeader("Content-Disposition", "inline");
    }
    res.send(data);
  } catch {
    // A person opening the link in a browser gets a readable page; API callers still get JSON.
    if (req.accepts(["json", "html"]) === "html") {
      return res
        .status(404)
        .type("html")
        .send(
          `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>File unavailable</title>` +
            `<body style="font-family:system-ui,sans-serif;background:#f3f2f0;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center">` +
            `<div style="background:#fff;border-radius:16px;padding:32px;max-width:420px;box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center">` +
            `<h2 style="margin:0 0 8px;color:#1a1512">This file is no longer available</h2>` +
            `<p style="margin:0;color:#6b7280;line-height:1.5">Please ask an administrator to upload it again.</p></div></body>`
        );
    }
    res.status(404).json({ error: "File not found" });
  }
});
