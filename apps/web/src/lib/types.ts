export type Role = "EMPLOYEE" | "MANAGER" | "ADMIN";
export type Country = "IRELAND" | "PHILIPPINES";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  country: Country;
  jobTitle?: string | null;
  managerId?: string | null;
  mustResetPassword?: boolean;
}
