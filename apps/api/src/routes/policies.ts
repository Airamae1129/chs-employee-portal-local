import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { allow } from "../middleware/rbac";
import { getStorageAdapter } from "../utils/storage";
import { writeAuditLog } from "../utils/audit";

/**
 * Policies & Templates: every policy title is a folder, and each folder
 * holds any number of documents (a link or an uploaded file) — the same
 * shape as Client Workspaces. Any staff member can add and update.
 */
export const policiesRouter = Router();
policiesRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

async function removeStoredFiles(keys: (string | null)[]) {
  for (const key of keys.filter((k): k is string => !!k)) {
    await db.deleteFrom("StoredFile").where("key", "=", key).execute();
  }
}

/** GET /policies — every folder with its documents, available to every role. */
policiesRouter.get("/", async (req, res) => {
  const policies = await db.selectFrom("Policy").selectAll().orderBy("title", "asc").execute();
  const items = policies.length
    ? await db.selectFrom("PolicyItem").selectAll().orderBy("createdAt", "asc").execute()
    : [];
  const myAcks = await db.selectFrom("PolicyAcknowledgement").select("policyId").where("userId", "=", req.user!.sub).execute();
  const ackedIds = new Set(myAcks.map((a) => a.policyId));

  res.json({
    policies: policies.map((p) => ({
      ...p,
      acknowledgedByMe: ackedIds.has(p.id),
      items: items
        .filter((i) => i.policyId === p.id)
        .map(({ fileKey, ...i }) => ({ ...i, hasFile: !!fileKey, fileName: fileKey ? fileKey.split("/").pop()!.replace(/^\d+-/, "") : null })),
    })),
  });
});

const folderSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional(),
  category: z.enum(["HR", "IT_SECURITY", "FINANCE", "OPERATIONS", "GENERAL"]).optional(),
  linkUrl: z.string().url().optional(),
});

/** POST /policies — create a folder (optionally with a first link or file). */
policiesRouter.post("/", upload.single("file"), async (req, res) => {
  const parsed = folderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A title is required" });

  const policy = await db
    .insertInto("Policy")
    .values({
      title: parsed.data.title,
      description: parsed.data.description || null,
      version: "1.0",
      owner: req.user!.name,
      effectiveDate: new Date().toISOString().slice(0, 10),
      category: parsed.data.category ?? "GENERAL",
      acknowledgementRequired: false,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  if (parsed.data.linkUrl || req.file) {
    let fileKey: string | null = null;
    if (req.file) {
      fileKey = `policies/${policy.id}/${Date.now()}-${req.file.originalname}`;
      await getStorageAdapter().putObject(fileKey, req.file.buffer, req.file.mimetype);
    }
    await db
      .insertInto("PolicyItem")
      .values({ policyId: policy.id, title: parsed.data.title, linkUrl: parsed.data.linkUrl ?? null, fileKey, createdBy: req.user!.sub })
      .execute();
  }

  await writeAuditLog({ userId: req.user!.sub, action: "PolicyPublished", targetId: policy.id });
  res.status(201).json({ policy });
});

const updateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().optional(),
});

/** PATCH /policies/:id — rename / re-describe a folder. */
policiesRouter.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid policy payload" });
  const policy = await db
    .updateTable("Policy")
    .set({ ...parsed.data, updatedAt: new Date() })
    .where("id", "=", req.params.id)
    .returningAll()
    .executeTakeFirst();
  if (!policy) return res.status(404).json({ error: "Policy not found" });
  await writeAuditLog({ userId: req.user!.sub, action: "PolicyUpdated", targetId: policy.id });
  res.json({ policy });
});

/** DELETE /policies/:id — removes the folder and every document in it. */
policiesRouter.delete("/:id", async (req, res) => {
  const items = await db.selectFrom("PolicyItem").select("fileKey").where("policyId", "=", req.params.id).execute();
  await removeStoredFiles(items.map((i) => i.fileKey));
  await db.deleteFrom("PolicyAcknowledgement").where("policyId", "=", req.params.id).execute();
  await db.deleteFrom("Policy").where("id", "=", req.params.id).execute();
  await writeAuditLog({ userId: req.user!.sub, action: "PolicyDeleted", targetId: req.params.id });
  res.json({ ok: true });
});

const itemSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional(),
  linkUrl: z.string().url().optional(),
});

/** POST /policies/:id/items — add a link or upload a file into a folder. */
policiesRouter.post("/:id/items", upload.single("file"), async (req, res) => {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A title and a valid link are required" });
  if (!req.file && !parsed.data.linkUrl) return res.status(400).json({ error: "Provide a link or upload a file" });
  const policy = await db.selectFrom("Policy").select("id").where("id", "=", req.params.id).executeTakeFirst();
  if (!policy) return res.status(404).json({ error: "Policy not found" });

  let fileKey: string | null = null;
  if (req.file) {
    fileKey = `policies/${policy.id}/${Date.now()}-${req.file.originalname}`;
    await getStorageAdapter().putObject(fileKey, req.file.buffer, req.file.mimetype);
  }
  const item = await db
    .insertInto("PolicyItem")
    .values({
      policyId: policy.id,
      title: parsed.data.title,
      description: parsed.data.description || null,
      linkUrl: req.file ? null : parsed.data.linkUrl ?? null,
      fileKey,
      createdBy: req.user!.sub,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ userId: req.user!.sub, action: "PolicyItemAdded", targetId: item.id });
  res.status(201).json({ item });
});

const itemUpdateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  linkUrl: z.string().url().optional(),
});

/** PATCH /policies/:id/items/:itemId */
policiesRouter.patch("/:id/items/:itemId", async (req, res) => {
  const parsed = itemUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid document payload" });
  const item = await db
    .updateTable("PolicyItem")
    .set({ ...parsed.data, updatedAt: new Date() })
    .where("id", "=", req.params.itemId)
    .where("policyId", "=", req.params.id)
    .returningAll()
    .executeTakeFirst();
  if (!item) return res.status(404).json({ error: "Document not found" });
  await writeAuditLog({ userId: req.user!.sub, action: "PolicyItemUpdated", targetId: item.id });
  res.json({ item });
});

/** DELETE /policies/:id/items/:itemId */
policiesRouter.delete("/:id/items/:itemId", async (req, res) => {
  const item = await db.selectFrom("PolicyItem").select(["id", "fileKey"]).where("id", "=", req.params.itemId).where("policyId", "=", req.params.id).executeTakeFirst();
  if (!item) return res.status(404).json({ error: "Document not found" });
  await removeStoredFiles([item.fileKey]);
  await db.deleteFrom("PolicyItem").where("id", "=", item.id).execute();
  await writeAuditLog({ userId: req.user!.sub, action: "PolicyItemDeleted", targetId: item.id });
  res.json({ ok: true });
});

/** GET /policies/:id/items/:itemId/file — short-lived signed link to an uploaded file. */
policiesRouter.get("/:id/items/:itemId/file", async (req, res) => {
  const item = await db.selectFrom("PolicyItem").select("fileKey").where("id", "=", req.params.itemId).where("policyId", "=", req.params.id).executeTakeFirst();
  if (!item?.fileKey) return res.status(404).json({ error: "No file for this document" });
  res.json({ fileUrl: await getStorageAdapter().getSignedUrl(item.fileKey) });
});

/** POST /policies/:id/acknowledge — read-receipt tracking. */
policiesRouter.post("/:id/acknowledge", async (req, res) => {
  // Admins publish and manage policies; they aren't required to acknowledge them.
  if (req.user!.role === "ADMIN") {
    return res.status(403).json({ error: "Admins don't need to acknowledge policies" });
  }
  const existing = await db
    .selectFrom("PolicyAcknowledgement")
    .selectAll()
    .where("policyId", "=", req.params.id)
    .where("userId", "=", req.user!.sub)
    .executeTakeFirst();
  const ack =
    existing ??
    (await db
      .insertInto("PolicyAcknowledgement")
      .values({ policyId: req.params.id, userId: req.user!.sub })
      .returningAll()
      .executeTakeFirstOrThrow());
  res.json({ acknowledgement: ack });
});

/** GET /policies/compliance/report — Admin: acknowledgement compliance (Phase 2). */
policiesRouter.get("/compliance/report", allow("ADMIN"), async (_req, res) => {
  const policies = await db.selectFrom("Policy").selectAll().where("acknowledgementRequired", "=", true).execute();
  // Admins aren't expected to acknowledge, so they're left out of the percentages.
  const totalUsersRow = await db
    .selectFrom("User")
    .select(({ fn }) => fn.countAll<string>().as("count"))
    .where("status", "=", "ACTIVE")
    .where("role", "!=", "ADMIN")
    .executeTakeFirst();
  const totalUsers = totalUsersRow ? parseInt(totalUsersRow.count, 10) : 0;

  const report = await Promise.all(
    policies.map(async (p) => {
      const row = await db
        .selectFrom("PolicyAcknowledgement")
        .innerJoin("User", "User.id", "PolicyAcknowledgement.userId")
        .select(({ fn }) => fn.countAll<string>().as("count"))
        .where("PolicyAcknowledgement.policyId", "=", p.id)
        .where("User.role", "!=", "ADMIN")
        .executeTakeFirst();
      const acknowledgedCount = row ? parseInt(row.count, 10) : 0;
      return { policy: p, acknowledgedCount, totalUsers, pct: totalUsers ? Math.round((acknowledgedCount / totalUsers) * 100) : 0 };
    })
  );
  res.json({ report });
});
