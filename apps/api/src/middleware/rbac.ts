import { Request, Response, NextFunction } from "express";
import { Role } from "@chs/db";

/**
 * Role-based route guard. Section 3/9: role is resolved server-side
 * from the authenticated session and NEVER trusted from the client.
 * Managers are also employees for their own timekeeping/requests, and
 * Admins can do everything a Manager/Employee can, so allow() treats
 * the role list as a minimum-bar allow-list rather than an exact match
 * — pass every role permitted to call the route.
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

/**
 * Ownership guard for "own resource" endpoints — a non-manager/admin
 * caller may only act on their own UserID (Section 7: "a user can only
 * ever fetch their own UserID unless acting as Manager/Admin over
 * their permitted scope"). Managers/Admins bypass this check; scoping
 * to "their team" for Managers is enforced per-route where the team
 * membership is looked up (see routes/time.ts, routes/hrRequests.ts).
 */
export function ownershipOrElevated(getTargetUserId: (req: Request) => string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const targetUserId = getTargetUserId(req);
    if (req.user.role === Role.ADMIN || req.user.role === Role.MANAGER) {
      return next();
    }
    if (req.user.sub !== targetUserId) {
      return res.status(403).json({ error: "You can only access your own records" });
    }
    next();
  };
}
