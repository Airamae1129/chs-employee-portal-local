import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { allow } from "../middleware/rbac";
import { writeAuditLog } from "../utils/audit";

export const workspacesRouter = Router();
workspacesRouter.use(requireAuth);

/** GET /workspaces — directory of clients, each with its nested links; own access-request status included. */
workspacesRouter.get("/", async (req, res) => {
  const workspaces = await db.selectFrom("ClientWorkspace").selectAll().orderBy("clientName", "asc").execute();
  const myRequests = await db.selectFrom("WorkspaceAccessRequest").selectAll().where("userId", "=", req.user!.sub).execute();
  const byWorkspace = new Map(myRequests.map((r) => [r.workspaceId, r]));
  const items = workspaces.length
    ? await db
        .selectFrom("ClientWorkspaceItem")
        .selectAll()
        .where("workspaceId", "in", workspaces.map((w) => w.id))
        .orderBy("title", "asc")
        .execute()
    : [];
  const itemsByWorkspace = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByWorkspace.get(item.workspaceId) ?? [];
    list.push(item);
    itemsByWorkspace.set(item.workspaceId, list);
  }
  res.json({
    workspaces: workspaces.map((w) => ({
      ...w,
      myAccessRequest: byWorkspace.get(w.id) ?? null,
      items: itemsByWorkspace.get(w.id) ?? [],
    })),
  });
});

const createWorkspaceSchema = z.object({
  clientName: z.string().min(1),
  description: z.string().optional(),
});

/** POST /workspaces — Manager/Admin creates a client folder (Client Workspaces: "Add Client"). */
workspacesRouter.post("/", allow("MANAGER", "ADMIN"), async (req, res) => {
  const parsed = createWorkspaceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid workspace payload" });
  const workspace = await db
    .insertInto("ClientWorkspace")
    .values({ clientName: parsed.data.clientName, description: parsed.data.description ?? null, linkUrl: null })
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ userId: req.user!.sub, action: "ClientWorkspaceCreated", targetId: workspace.id });
  res.status(201).json({ workspace });
});

const updateWorkspaceSchema = z.object({
  clientName: z.string().min(1).optional(),
  description: z.string().optional(),
});

/** PATCH /workspaces/:id — edit a client folder. */
workspacesRouter.patch("/:id", allow("MANAGER", "ADMIN"), async (req, res) => {
  const parsed = updateWorkspaceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid workspace payload" });
  const workspace = await db
    .updateTable("ClientWorkspace")
    .set({ ...parsed.data, updatedAt: new Date() })
    .where("id", "=", req.params.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ userId: req.user!.sub, action: "ClientWorkspaceUpdated", targetId: workspace.id });
  res.json({ workspace });
});

/** DELETE /workspaces/:id — remove a client folder and its links. */
workspacesRouter.delete("/:id", allow("MANAGER", "ADMIN"), async (req, res) => {
  await db.deleteFrom("WorkspaceAccessRequest").where("workspaceId", "=", req.params.id).execute();
  await db.deleteFrom("ClientWorkspaceItem").where("workspaceId", "=", req.params.id).execute();
  await db.deleteFrom("ClientWorkspace").where("id", "=", req.params.id).execute();
  await writeAuditLog({ userId: req.user!.sub, action: "ClientWorkspaceDeleted", targetId: req.params.id });
  res.json({ ok: true });
});

const itemSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  linkUrl: z.string().url(),
});

/**
 * POST /workspaces/:id/items — a titled SharePoint link inside a client
 * folder. Revision: "visible for ALL Employee, Manager and Admin anyone
 * can Update" — any authenticated staff member can add or edit these.
 */
workspacesRouter.post("/:id/items", async (req, res) => {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "title and linkUrl are required" });
  const item = await db
    .insertInto("ClientWorkspaceItem")
    .values({
      workspaceId: req.params.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      linkUrl: parsed.data.linkUrl,
      createdBy: req.user!.sub,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  res.status(201).json({ item });
});

const itemUpdateSchema = itemSchema.partial();

workspacesRouter.patch("/:id/items/:itemId", async (req, res) => {
  const parsed = itemUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid item payload" });
  const item = await db
    .updateTable("ClientWorkspaceItem")
    .set({ ...parsed.data, updatedAt: new Date() })
    .where("id", "=", req.params.itemId)
    .returningAll()
    .executeTakeFirstOrThrow();
  res.json({ item });
});

workspacesRouter.delete("/:id/items/:itemId", allow("MANAGER", "ADMIN"), async (req, res) => {
  await db.deleteFrom("ClientWorkspaceItem").where("id", "=", req.params.itemId).execute();
  res.json({ ok: true });
});

/** POST /workspaces/:id/request-access */
workspacesRouter.post("/:id/request-access", async (req, res) => {
  const workspace = await db.selectFrom("ClientWorkspace").selectAll().where("id", "=", req.params.id).executeTakeFirst();
  if (!workspace) return res.status(404).json({ error: "Workspace not found" });

  const existing = await db
    .selectFrom("WorkspaceAccessRequest")
    .selectAll()
    .where("workspaceId", "=", workspace.id)
    .where("userId", "=", req.user!.sub)
    .executeTakeFirst();

  const request = existing
    ? await db
        .updateTable("WorkspaceAccessRequest")
        .set({ status: "REQUESTED", requestedAt: new Date(), decidedById: null, decidedAt: null })
        .where("id", "=", existing.id)
        .returningAll()
        .executeTakeFirstOrThrow()
    : await db
        .insertInto("WorkspaceAccessRequest")
        .values({ id: randomUUID(), workspaceId: workspace.id, userId: req.user!.sub })
        .returningAll()
        .executeTakeFirstOrThrow();

  res.status(201).json({ request });
});

/** GET /workspaces/requests/pending — Manager/Admin approves requests. */
workspacesRouter.get("/requests/pending", allow("MANAGER", "ADMIN"), async (_req, res) => {
  const requests = await db
    .selectFrom("WorkspaceAccessRequest")
    .selectAll()
    .where("status", "=", "REQUESTED")
    .orderBy("requestedAt", "asc")
    .execute();

  const workspaceIds = [...new Set(requests.map((r) => r.workspaceId))];
  const userIds = [...new Set(requests.map((r) => r.userId))];
  const [workspaces, users] = await Promise.all([
    workspaceIds.length ? db.selectFrom("ClientWorkspace").selectAll().where("id", "in", workspaceIds).execute() : [],
    userIds.length ? db.selectFrom("User").select(["id", "name", "email"]).where("id", "in", userIds).execute() : [],
  ]);
  const wsById = new Map(workspaces.map((w) => [w.id, w]));
  const userById = new Map(users.map((u) => [u.id, u]));

  res.json({
    requests: requests.map((r) => ({ ...r, workspace: wsById.get(r.workspaceId), user: userById.get(r.userId) })),
  });
});

const decisionSchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]) });

workspacesRouter.patch("/requests/:id/decision", allow("MANAGER", "ADMIN"), async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "decision is required" });

  const updated = await db
    .updateTable("WorkspaceAccessRequest")
    .set({ status: parsed.data.decision, decidedById: req.user!.sub, decidedAt: new Date() })
    .where("id", "=", req.params.id)
    .returningAll()
    .executeTakeFirstOrThrow();

  if (parsed.data.decision === "APPROVED") {
    await writeAuditLog({ userId: req.user!.sub, action: "WorkspaceAccessGranted", targetId: updated.id });
  }

  res.json({ request: updated });
});
