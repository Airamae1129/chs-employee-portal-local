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
  ClipboardList,
  KeyRound,
} from "lucide-react";
import { Role } from "./types";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  roles: Role[];
}

// The roles table (UAT / IT audit) drives which nav items each role sees.
// Every role gets the self-service pages; Manager/Admin/Payroll add their
// own scopes. Payroll is a separate role from Admin: it owns Payroll, and
// Admin no longer sees salaries or payroll. The server enforces all of
// this independently — hiding a menu item is not the control.
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid, roles: ["EMPLOYEE", "MANAGER", "ADMIN", "PAYROLL"] },
  { href: "/timekeeping", label: "Timekeeping & Calendar", icon: Clock, roles: ["EMPLOYEE", "MANAGER", "ADMIN", "PAYROLL"] },
  { href: "/tasks", label: "Task Assigned", icon: ClipboardList, roles: ["EMPLOYEE", "MANAGER", "ADMIN", "PAYROLL"] },
  { href: "/hr-requests", label: "HR Requests", icon: FileText, roles: ["EMPLOYEE", "MANAGER", "ADMIN", "PAYROLL"] },
  { href: "/policies", label: "Policies & Templates", icon: BookOpen, roles: ["EMPLOYEE", "MANAGER", "ADMIN", "PAYROLL"] },
  { href: "/workspaces", label: "Client Workspaces", icon: Link2, roles: ["EMPLOYEE", "MANAGER", "ADMIN", "PAYROLL"] },
  { href: "/payslips", label: "Payslips", icon: Wallet, roles: ["EMPLOYEE", "MANAGER", "ADMIN", "PAYROLL"] },
  { href: "/team", label: "My Team", icon: Users, roles: ["MANAGER", "ADMIN", "PAYROLL"] },
  { href: "/admin/holidays", label: "Holidays & Birthdays", icon: CalendarDays, roles: ["ADMIN"] },
  { href: "/admin/payroll", label: "Payroll", icon: Banknote, roles: ["PAYROLL"] },
  { href: "/admin/users", label: "Staff Accounts", icon: Users, roles: ["ADMIN"] },
  { href: "/admin/audit-log", label: "Audit Log", icon: ShieldCheck, roles: ["ADMIN"] },
  { href: "/account/security", label: "Account Security", icon: KeyRound, roles: ["EMPLOYEE", "MANAGER", "ADMIN", "PAYROLL"] },
];

export function navForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
