import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { allow } from "../middleware/rbac";
import { scopedUserIds } from "../utils/team";
import { writeAuditLog } from "../utils/audit";
import { getStorageAdapter } from "../utils/storage";
import { computeLeaveBalance } from "../utils/leave";

export const hrRequestsRouter = Router();
hrRequestsRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const createSchema = z.object({
  requestType: z.enum(["LEAVE", "COE", "HR_LETTER", "OTHER"]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  leaveType: z.string().optional(),
  payType: z.enum(["PAID", "UNPAID"]).optional(),
  comments: z.string().optional(),
});

/** POST /hr-requests — any employee submits; auto-routes to their manager. */
hrRequestsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid HR request payload" });

  const caller = await db.selectFrom("User").selectAll().where("id", "=", req.user!.sub).executeTakeFirst();
  const request = await db
    .insertInto("HRRequest")
    .values({
      requestType: parsed.data.requestType,
      employeeId: req.user!.sub,
      approverId: caller?.managerId ?? null,
      startDate: parsed.data.startDate ?? null,
      endDate: parsed.data.endDate ?? null,
      leaveType: parsed.data.leaveType ?? null,
      payType: parsed.data.payType ?? null,
      comments: parsed.data.comments ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  if (parsed.data.requestType === "LEAVE" && parsed.data.startDate && parsed.data.endDate) {
    await db
      .insertInto("CalendarEntry")
      .values({
        userId: req.user!.sub,
        date: parsed.data.startDate,
        entryType: "LEAVE",
        title: `Leave request (${request.status})`,
        source: "SYSTEM",
      })
      .execute();
  }

  await writeAuditLog({ userId: req.user!.sub, action: "HRRequestSubmitted", targetId: request.id });
  res.status(201).json({ request });
});

/** GET /hr-requests/me */
hrRequestsRouter.get("/me", async (req, res) => {
  const requests = await db
    .selectFrom("HRRequest")
    .selectAll()
    .where("employeeId", "=", req.user!.sub)
    .orderBy("submissionDate", "desc")
    .execute();
  res.json({ requests });
});

/**
 * GET /hr-requests/leave-balance — own 12-paid-leave-days-per-year
 * balance (Dashboard + HR Requests revision). Only reduces once a
 * LEAVE request is actually APPROVED — submitted/rejected requests
 * don't touch it.
 */
hrRequestsRouter.get("/leave-balance", async (req, res) => {
  const balance = await computeLeaveBalance(req.user!.sub);
  res.json({ balance });
});

/** GET /hr-requests/leave-balance/team — Manager/Admin: every team member's balance, for the team requests table. */
hrRequestsRouter.get("/leave-balance/team", allow("MANAGER", "ADMIN"), async (req, res) => {
  const scope = await scopedUserIds(req.user!);
  let userQuery = db.selectFrom("User").select(["id", "name"]);
  if (scope !== "ALL") userQuery = userQuery.where("id", "in", scope);
  const users = await userQuery.execute();

  const balances = await Promise.all(
    users.map(async (u) => ({ userId: u.id, name: u.name, ...(await computeLeaveBalance(u.id)) }))
  );
  res.json({ balances });
});

/** GET /hr-requests/team — Manager (own reports, pending + decided) / Admin (all + escalations) */
hrRequestsRouter.get("/team", allow("MANAGER", "ADMIN"), async (req, res) => {
  const scope = await scopedUserIds(req.user!);
  let query = db.selectFrom("HRRequest").selectAll();
  if (scope !== "ALL") query = query.where("employeeId", "in", scope);
  const requests = await query.orderBy("submissionDate", "desc").execute();

  const employeeIds = [...new Set(requests.map((r) => r.employeeId))];
  const employees = employeeIds.length
    ? await db.selectFrom("User").select(["id", "name", "email", "country"]).where("id", "in", employeeIds).execute()
    : [];
  const byId = new Map(employees.map((e) => [e.id, e]));

  res.json({ requests: requests.map((r) => ({ ...r, employee: byId.get(r.employeeId) })) });
});

const decisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comments: z.string().optional(),
});

/** PATCH /hr-requests/:id/decision — Manager approves/rejects own team; Admin any (escalations). */
hrRequestsRouter.patch("/:id/decision", allow("MANAGER", "ADMIN"), async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "decision (APPROVED|REJECTED) is required" });

  const existing = await db.selectFrom("HRRequest").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "Request not found" });

  if (req.user!.role === "MANAGER") {
    const scope = await scopedUserIds(req.user!);
    if (scope !== "ALL" && !scope.includes(existing.employeeId)) {
      return res.status(403).json({ error: "You can only decide on requests from your own team" });
    }
  }

  const updated = await db
    .updateTable("HRRequest")
    .set({
      status: parsed.data.decision,
      approverId: req.user!.sub,
      decisionDate: new Date(),
      comments: parsed.data.comments ?? existing.comments,
    })
    .where("id", "=", existing.id)
    .returningAll()
    .executeTakeFirstOrThrow();

  await writeAuditLog({
    userId: req.user!.sub,
    action: "RequestApproved",
    targetId: updated.id,
    metadata: { decision: parsed.data.decision },
  });

  res.json({ request: updated });
});

/**
 * POST /hr-requests/:id/upload — Manager/Admin attaches the fulfilling
 * document (Certificate of Employment, HR Letter) so the employee can
 * view/download it (HR Requests revision).
 */
hrRequestsRouter.post("/:id/upload", allow("MANAGER", "ADMIN"), upload.single("file"), async (req, res) => {
  const existing = await db.selectFrom("HRRequest").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!existing) return res.status(404).json({ error: "Request not found" });
  if (!req.file) return res.status(400).json({ error: "A file upload is required" });

  if (req.user!.role === "MANAGER") {
    const scope = await scopedUserIds(req.user!);
    if (scope !== "ALL" && !scope.includes(existing.employeeId)) {
      return res.status(403).json({ error: "You can only upload documents for your own team" });
    }
  }

  const fileKey = `hr-requests/${existing.id}/${Date.now()}-${req.file.originalname}`;
  await getStorageAdapter().putObject(fileKey, req.file.buffer, req.file.mimetype);

  const updated = await db
    .updateTable("HRRequest")
    .set({ fileKey, updatedAt: new Date() })
    .where("id", "=", existing.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ userId: req.user!.sub, action: "HRRequestDocumentUploaded", targetId: existing.id });
  res.status(201).json({ request: updated });
});

/** GET /hr-requests/:id/file — signed URL; the requesting employee, their Manager, or Admin. */
hrRequestsRouter.get("/:id/file", async (req, res) => {
  const existing = await db.selectFrom("HRRequest").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!existing || !existing.fileKey) return res.status(404).json({ error: "No document uploaded for this request" });

  const isOwner = existing.employeeId === req.user!.sub;
  const isAdmin = req.user!.role === "ADMIN";
  let isManagerInScope = false;
  if (req.user!.role === "MANAGER") {
    const scope = await scopedUserIds(req.user!);
    isManagerInScope = scope === "ALL" || scope.includes(existing.employeeId);
  }
  if (!isOwner && !isAdmin && !isManagerInScope) {
    return res.status(403).json({ error: "You don't have access to this document" });
  }

  const fileUrl = await getStorageAdapter().getSignedUrl(existing.fileKey);
  await writeAuditLog({ userId: req.user!.sub, action: "HRRequestDocumentViewed", targetId: existing.id });
  res.json({ fileUrl });
});
