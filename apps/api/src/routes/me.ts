import { Router } from "express";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";

export const meRouter = Router();

meRouter.get("/", requireAuth, async (req, res) => {
  const user = await db
    .selectFrom("User")
    .select(["id", "name", "email", "role", "country", "jobTitle", "managerId", "mustResetPassword"])
    .where("id", "=", req.user!.sub)
    .executeTakeFirst();
  if (!user) return res.status(404).json({ error: "User not found" });

  let manager = null;
  if (user.managerId) {
    manager = await db.selectFrom("User").select(["id", "name", "email"]).where("id", "=", user.managerId).executeTakeFirst();
  }

  res.json({ user: { ...user, manager: manager ?? null } });
});
