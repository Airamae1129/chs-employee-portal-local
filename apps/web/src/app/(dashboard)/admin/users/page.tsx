"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, KeyRound, UserX, UserCheck, Save, UserPlus } from "lucide-react";
import { PageHeader, Card, Badge } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { notifySuccess, notifyError } from "@/lib/alerts";

type Role = "EMPLOYEE" | "MANAGER" | "ADMIN" | "PAYROLL";

interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  country: "IRELAND" | "PHILIPPINES";
  status: "ACTIVE" | "INACTIVE";
  jobTitle?: string;
  managerId?: string | null;
  manager?: { name: string } | null;
  leaveAllowanceDays: number;
  locked: boolean;
}

const ROLE_LABEL: Record<Role, string> = { EMPLOYEE: "Employee", MANAGER: "Manager", ADMIN: "Admin", PAYROLL: "Payroll" };

function emptyForm() {
  return {
    name: "",
    email: "",
    role: "EMPLOYEE" as Role,
    country: "IRELAND" as StaffUser["country"],
    jobTitle: "",
    managerId: "",
    leaveAllowanceDays: "12",
    tempPassword: "",
  };
}

/**
 * Admin: staff accounts. Salaries aren't shown or set here — that's the
 * Payroll role's job (Payroll page). Admins can't change their own role,
 * status or leave allowance; another Admin has to.
 */
export default function AdminUsersPage() {
  const { user: me } = useCurrentUser();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [resetTarget, setResetTarget] = useState<StaffUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [form, setForm] = useState(emptyForm());
  const editingSelf = !!editing && editing.id === me?.id;

  function refresh() {
    apiFetch<{ users: StaffUser[] }>("/users").then(({ users }) => setUsers(users));
  }
  useEffect(refresh, []);

  async function createUser() {
    try {
      await apiFetch("/users", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          role: form.role,
          country: form.country,
          jobTitle: form.jobTitle || undefined,
          managerId: form.managerId || undefined,
          leaveAllowanceDays: form.leaveAllowanceDays === "" ? undefined : Number(form.leaveAllowanceDays),
          temporaryPassword: form.tempPassword,
        }),
      });
      setShowForm(false);
      setForm(emptyForm());
      refresh();
      notifySuccess("Staff account created", "They'll be asked to set a new password on first login.");
    } catch (e) {
      notifyError("Couldn't create account", e instanceof Error ? e.message : undefined);
    }
  }

  function openEdit(u: StaffUser) {
    setEditing(u);
    setForm({
      name: u.name,
      email: u.email,
      role: u.role,
      country: u.country,
      jobTitle: u.jobTitle ?? "",
      managerId: u.managerId ?? "",
      leaveAllowanceDays: String(u.leaveAllowanceDays),
      tempPassword: "",
    });
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      await apiFetch(`/users/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          country: form.country,
          jobTitle: form.jobTitle || undefined,
          managerId: form.managerId || undefined,
          ...(editingSelf ? {} : { role: form.role, leaveAllowanceDays: Number(form.leaveAllowanceDays) }),
        }),
      });
      setEditing(null);
      refresh();
      notifySuccess("Staff details updated");
    } catch (e) {
      notifyError("Couldn't save changes", e instanceof Error ? e.message : undefined);
    }
  }

  async function toggleStatus(u: StaffUser) {
    try {
      await apiFetch(`/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: u.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }),
      });
      refresh();
    } catch (e) {
      notifyError("Couldn't change status", e instanceof Error ? e.message : undefined);
    }
  }

  async function resetPassword() {
    if (!resetTarget) return;
    try {
      await apiFetch(`/users/${resetTarget.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ newPassword }),
      });
      setResetTarget(null);
      setNewPassword("");
      refresh();
      notifySuccess("Password reset", "They'll be asked to set a new password on next login. A locked account is unlocked.");
    } catch (e) {
      notifyError("Couldn't reset password", e instanceof Error ? e.message : undefined);
    }
  }

  const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal disabled:bg-gray-50 disabled:text-gray-400";

  const formFields = (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <label className="mb-1 block text-sm font-medium text-chs-charcoal">Full name</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-chs-charcoal">Email</label>
        <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-chs-charcoal">Role</label>
        <select value={form.role} disabled={editingSelf} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} className={inputClass}>
          <option value="EMPLOYEE">Employee</option>
          <option value="MANAGER">Manager</option>
          <option value="ADMIN">Admin</option>
          <option value="PAYROLL">Payroll</option>
        </select>
        {editingSelf && <p className="mt-1 text-xs text-gray-400">Another Admin has to change your role.</p>}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-chs-charcoal">Country</label>
        <select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value as StaffUser["country"] })} className={inputClass}>
          <option value="IRELAND">Ireland</option>
          <option value="PHILIPPINES">Philippines</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-chs-charcoal">Job title</label>
        <input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} className={inputClass} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-chs-charcoal">Paid leave allowance (days / year)</label>
        <input
          type="number"
          min={0}
          max={365}
          disabled={editingSelf}
          value={form.leaveAllowanceDays}
          onChange={(e) => setForm({ ...form, leaveAllowanceDays: e.target.value })}
          className={inputClass}
        />
        {editingSelf && <p className="mt-1 text-xs text-gray-400">Another Admin has to adjust your allowance.</p>}
      </div>
      {form.role !== "ADMIN" && (
        <div>
          <label className="mb-1 block text-sm font-medium text-chs-charcoal">Manager</label>
          <select value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })} className={inputClass}>
            <option value="">— No manager —</option>
            {users
              .filter((u) => (u.role === "MANAGER" || u.role === "ADMIN") && u.id !== editing?.id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({ROLE_LABEL[u.role]})
                </option>
              ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">Approves their requests and time corrections.</p>
        </div>
      )}
      {!editing && (
        <div className="md:col-span-2">
          <label className="mb-1 block text-sm font-medium text-chs-charcoal">Temporary password</label>
          <input
            value={form.tempPassword}
            onChange={(e) => setForm({ ...form, tempPassword: e.target.value })}
            placeholder="At least 8 characters — they'll set their own on first login"
            className={inputClass}
          />
        </div>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Staff Accounts"
        action={
          <Button icon={<Plus size={16} />} onClick={() => { setForm(emptyForm()); setShowForm(true); }}>
            Add staff account
          </Button>
        }
      />

      {showForm && (
        <Card className="mb-6">
          {formFields}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button icon={<UserPlus size={14} />} onClick={createUser} disabled={!form.name || !form.email || form.tempPassword.length < 8}>
              Create account
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
                <th className="py-2">Name</th>
                <th className="py-2">Email</th>
                <th className="py-2">Role</th>
                <th className="py-2">Country</th>
                <th className="py-2">Job title</th>
                <th className="py-2">Leave / yr</th>
                <th className="py-2">Manager</th>
                <th className="py-2">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === me?.id;
                return (
                  <tr key={u.id} className="border-b border-gray-50">
                    <td className="py-2.5">
                      {u.name}
                      {self && <span className="ml-1.5 text-xs text-gray-400">(you)</span>}
                    </td>
                    <td className="py-2.5 text-gray-500">{u.email}</td>
                    <td className="py-2.5">{ROLE_LABEL[u.role]}</td>
                    <td className="py-2.5">{u.country}</td>
                    <td className="py-2.5 text-gray-500">{u.jobTitle ?? "—"}</td>
                    <td className="py-2.5 text-gray-500">{u.leaveAllowanceDays}</td>
                    <td className="py-2.5 text-gray-500">{u.manager?.name ?? "—"}</td>
                    <td className="py-2.5">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={u.status === "ACTIVE" ? "green" : "red"}>{u.status}</Badge>
                        {u.locked && <Badge tone="red">LOCKED</Badge>}
                      </div>
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="secondary" icon={<Pencil size={12} />} onClick={() => openEdit(u)}>
                          Edit
                        </Button>
                        {!self && (
                          <>
                            <Button size="sm" variant="secondary" icon={<KeyRound size={12} />} onClick={() => setResetTarget(u)}>
                              {u.locked ? "Unlock & reset" : "Reset password"}
                            </Button>
                            <Button
                              size="sm"
                              variant={u.status === "ACTIVE" ? "destructive" : "success"}
                              icon={u.status === "ACTIVE" ? <UserX size={12} /> : <UserCheck size={12} />}
                              onClick={() => toggleStatus(u)}
                            >
                              {u.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-400">Salaries are managed by the Payroll role. Review roles whenever staff join, move or leave.</p>
      </Card>

      {editing && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <Card className="w-full max-w-lg">
            <div className="text-base font-bold text-chs-charcoal">Edit — {editing.name}</div>
            <div className="mt-4">{formFields}</div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button icon={<Save size={14} />} onClick={saveEdit}>Save changes</Button>
            </div>
          </Card>
        </div>
      )}

      {resetTarget && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <Card className="w-full max-w-sm">
            <div className="text-base font-bold text-chs-charcoal">Reset password — {resetTarget.name}</div>
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New temporary password"
              className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setResetTarget(null)}>Cancel</Button>
              <Button icon={<KeyRound size={14} />} onClick={resetPassword} disabled={newPassword.length < 8}>Reset</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
