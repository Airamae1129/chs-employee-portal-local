import {
  LayoutGrid,
  Clock,
  FileText,
  BookOpen,
  Link2,
  Wallet,
  Users,
  CalendarDays,
  ShieldCheck,
  Banknote,
} from "lucide-react";
import { Role } from "./types";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  roles: Role[];
}

// Section 3's capability table drives which nav items each role sees.
// Managers/Admins get everything an Employee gets (self-service) plus
// their extra scopes, matching "Managers are also employees for their
// own timekeeping/requests."
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid, roles: ["EMPLOYEE", "MANAGER", "ADMIN"] },
  { href: "/timekeeping", label: "Timekeeping & Calendar", icon: Clock, roles: ["EMPLOYEE", "MANAGER", "ADMIN"] },
  { href: "/hr-requests", label: "HR Requests", icon: FileText, roles: ["EMPLOYEE", "MANAGER", "ADMIN"] },
  { href: "/policies", label: "Policies & Templates", icon: BookOpen, roles: ["EMPLOYEE", "MANAGER", "ADMIN"] },
  { href: "/workspaces", label: "Client Workspaces", icon: Link2, roles: ["EMPLOYEE", "MANAGER", "ADMIN"] },
  { href: "/payslips", label: "Payslips", icon: Wallet, roles: ["EMPLOYEE", "MANAGER", "ADMIN"] },
  { href: "/team", label: "My Team", icon: Users, roles: ["MANAGER", "ADMIN"] },
  { href: "/admin/holidays", label: "Holidays & Birthdays", icon: CalendarDays, roles: ["ADMIN"] },
  { href: "/admin/payroll", label: "Payroll", icon: Banknote, roles: ["ADMIN"] },
  { href: "/admin/users", label: "Staff Accounts", icon: Users, roles: ["ADMIN"] },
  { href: "/admin/audit-log", label: "Audit Log", icon: ShieldCheck, roles: ["ADMIN"] },
];

export function navForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
