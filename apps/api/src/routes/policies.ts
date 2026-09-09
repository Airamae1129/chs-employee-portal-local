import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { allow } from "../middleware/rbac";
import { getStorageAdapter } from "../utils/storage";
import { writeAuditLog } from "../utils/audit";

export const policiesRouter = Router();
policiesRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/** GET /policies — categorized list, available to every role. */
policiesRouter.get("/", async (req, res) => {
  const policies = await db.selectFrom("Policy").selectAll().orderBy("category", "asc").orderBy("title", "asc").execute();
  const myAcks = await db
    .selectFrom("PolicyAcknowledgement")
    .select("policyId")
    .where("userId", "=", req.user!.sub)
    .execute();
  const ackedIds = new Set(myAcks.map((a) => a.policyId));
  res.json({ policies: policies.map((p) => ({ ...p, acknowledgedByMe: ackedIds.has(p.id) })) });
});

/** GET /policies/:id — detail + a short-lived signed URL to the file. */
policiesRouter.get("/:id", async (req, res) => {
  const policy = await db.selectFrom("Policy").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!policy) return res.status(404).json({ error: "Policy not found" });
  const adapter = getStorageAdapter();
  let fileUrl: string | null = null;
  try {
    fileUrl = await adapter.getSignedUrl(policy.fileKey);
  } catch {
    fileUrl = null; // file not yet uploaded for this seeded policy
  }
  res.json({ policy, fileUrl });
});

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  linkUrl: z.string().url().optional(),
  category: z.enum(["HR", "IT_SECURITY", "FINANCE", "OPERATIONS", "GENERAL"]).optional(),
});

/**
 * POST /policies — publish a policy (SharePoint-style link, optionally
 * also a file upload). Revision: "visible for ALL Employee, Manager and
 * Admin anyone can Update" — any authenticated staff member can add or
 * edit policies/templates, not just Admin.
 */
policiesRouter.post("/", upload.single("file"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid policy payload" });
  if (!req.file && !parsed.data.linkUrl) {
    return res.status(400).json({ error: "Provide a link or upload a file" });
  }

  let fileKey: string | null = null;
  if (req.file) {
    fileKey = `policies/${Date.now()}-${req.file.originalname}`;
    await getStorageAdapter().putObject(fileKey, req.file.buffer, req.file.mimetype);
  }

  const policy = await db
    .insertInto("Policy")
    .values({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      linkUrl: parsed.data.linkUrl ?? null,
      version: "1.0",
      owner: req.user!.name,
      effectiveDate: new Date().toISOString().slice(0, 10),
      category: parsed.data.category ?? "GENERAL",
      acknowledgementRequired: false,
      fileKey,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ userId: req.user!.sub, action: "PolicyPublished", targetId: policy.id });
  res.status(201).json({ policy });
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  linkUrl: z.string().url().optional(),
});

/** PATCH /policies/:id — any staff member can update (revision: "anyone can Update"). */
policiesRouter.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid policy payload" });
  const policy = await db
    .updateTable("Policy")
    .set({ ...parsed.data, updatedAt: new Date() })
    .where("id", "=", req.params.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ userId: req.user!.sub, action: "PolicyUpdated", targetId: policy.id });
  res.json({ policy });
});

/** DELETE /policies/:id */
policiesRouter.delete("/:id", async (req, res) => {
  await db.deleteFrom("PolicyAcknowledgement").where("policyId", "=", req.params.id).execute();
  await db.deleteFrom("Policy").where("id", "=", req.params.id).execute();
  await writeAuditLog({ userId: req.user!.sub, action: "PolicyDeleted", targetId: req.params.id });
  res.json({ ok: true });
});

/** POST /policies/:id/acknowledge — read-receipt tracking. */
policiesRouter.post("/:id/acknowledge", async (req, res) => {
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
  const totalUsersRow = await db.selectFrom("User").select(({ fn }) => fn.countAll<string>().as("count")).where("status", "=", "ACTIVE").executeTakeFirst();
  const totalUsers = totalUsersRow ? parseInt(totalUsersRow.count, 10) : 0;

  const report = await Promise.all(
    policies.map(async (p) => {
      const row = await db
        .selectFrom("PolicyAcknowledgement")
        .select(({ fn }) => fn.countAll<string>().as("count"))
        .where("policyId", "=", p.id)
        .executeTakeFirst();
      const acknowledgedCount = row ? parseInt(row.count, 10) : 0;
      return { policy: p, acknowledgedCount, totalUsers, pct: totalUsers ? Math.round((acknowledgedCount / totalUsers) * 100) : 0 };
    })
  );
  res.json({ report });
});
