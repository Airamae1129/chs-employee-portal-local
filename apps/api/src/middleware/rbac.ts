import { Request, Response, NextFunction } from "express";
import { Role } from "@chs/db";

/**
 * Role-based route guard — deny by default. The role comes from the
 * database on every request (see requireAuth), never from the client,
 * and only the roles listed may call the route; there's no hierarchy, so
 * Admin is not implicitly allowed what Payroll or a Manager can do. Pass
 * every permitted role explicitly, per the roles table. Ownership and
 * team scoping are enforced per route (see utils/team.ts).
 */
export function allow(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission to perform this action" });
    }
    next();
  };
}
