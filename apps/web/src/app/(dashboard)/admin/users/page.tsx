"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, KeyRound, UserX, UserCheck, Save, UserPlus } from "lucide-react";
import { PageHeader, Card, Badge } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { apiFetch } from "@/lib/api";
import { notifySuccess, notifyError } from "@/lib/alerts";

interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: "EMPLOYEE" | "MANAGER" | "ADMIN";
  country: "IRELAND" | "PHILIPPINES";
  status: "ACTIVE" | "INACTIVE";
  jobTitle?: string;
  salary?: string | null;
  salaryCurrency?: string | null;
  managerId?: string | null;
  manager?: { name: string } | null;
}

const CURRENCY_SYMBOL: Record<string, string> = { EUR: "€", PHP: "₱" };

function emptyForm() {
  return { name: "", email: "", role: "EMPLOYEE" as StaffUser["role"], country: "IRELAND" as StaffUser["country"], jobTitle: "", salary: "", managerId: "", tempPassword: "" };
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [resetTarget, setResetTarget] = useState<StaffUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [form, setForm] = useState(emptyForm());

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
          salary: form.salary ? Number(form.salary) : undefined,
          managerId: form.managerId || undefined,
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
      salary: u.salary ?? "",
      managerId: u.managerId ?? "",
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
          role: form.role,
          country: form.country,
          jobTitle: form.jobTitle || undefined,
          salary: form.salary ? Number(form.salary) : undefined,
          managerId: form.managerId || undefined,
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
    await apiFetch(`/users/${u.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: u.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }),
    });
    refresh();
  }

  async function resetPassword() {
    if (!resetTarget) return;
    await apiFetch(`/users/${resetTarget.id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ newPassword }),
    });
    setResetTarget(null);
    setNewPassword("");
    notifySuccess("Password reset", "They'll be asked to set a new password on next login.");
  }

  const formFields = (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <label className="mb-1 block text-sm font-medium text-chs-charcoal">Full name</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-chs-charcoal">Email</label>
        <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-chs-charcoal">Role</label>
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffUser["role"] })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal">
          <option value="EMPLOYEE">Employee</option>
          <option value="MANAGER">Manager</option>
          <option value="ADMIN">Admin</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-chs-charcoal">Country</label>
        <select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value as StaffUser["country"] })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal">
          <option value="IRELAND">Ireland</option>
          <option value="PHILIPPINES">Philippines</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-chs-charcoal">Job title</label>
        <input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-chs-charcoal">
          Salary ({form.country === "IRELAND" ? "EUR" : "PHP"} / month)
        </label>
        <input
          type="number"
          min={0}
          value={form.salary}
          onChange={(e) => setForm({ ...form, salary: e.target.value })}
          placeholder="e.g. 50000"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
        />
      </div>
      {form.role !== "ADMIN" && (
        <div>
          <label className="mb-1 block text-sm font-medium text-chs-charcoal">Manager</label>
          <select
            value={form.managerId}
            onChange={(e) => setForm({ ...form, managerId: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
          >
            <option value="">— No manager —</option>
            {users
              .filter((u) => (u.role === "MANAGER" || u.role === "ADMIN") && u.id !== editing?.id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role === "ADMIN" ? "Admin" : "Manager"})
                </option>
              ))}
          </select>
        </div>
      )}
      {!editing && (
        <div className="md:col-span-2">
          <label className="mb-1 block text-sm font-medium text-chs-charcoal">Temporary password</label>
          <input
            value={form.tempPassword}
            onChange={(e) => setForm({ ...form, tempPassword: e.target.value })}
            placeholder="At least 8 characters — they'll set their own on first login"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
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
                <th className="py-2">Salary</th>
                <th className="py-2">Manager</th>
                <th className="py-2">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-50">
                  <td className="py-2.5">{u.name}</td>
                  <td className="py-2.5 text-gray-500">{u.email}</td>
                  <td className="py-2.5">{u.role}</td>
                  <td className="py-2.5">{u.country}</td>
                  <td className="py-2.5 text-gray-500">{u.jobTitle ?? "—"}</td>
                  <td className="py-2.5 text-gray-500">
                    {u.salary ? `${CURRENCY_SYMBOL[u.salaryCurrency ?? ""] ?? ""}${Number(u.salary).toLocaleString()}` : "—"}
                  </td>
                  <td className="py-2.5 text-gray-500">{u.manager?.name ?? "—"}</td>
                  <td className="py-2.5">
                    <Badge tone={u.status === "ACTIVE" ? "green" : "red"}>{u.status}</Badge>
                  </td>
                  <td className="py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="secondary" icon={<Pencil size={12} />} onClick={() => openEdit(u)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="secondary" icon={<KeyRound size={12} />} onClick={() => setResetTarget(u)}>
                        Reset password
                      </Button>
                      <Button
                        size="sm"
                        variant={u.status === "ACTIVE" ? "destructive" : "success"}
                        icon={u.status === "ACTIVE" ? <UserX size={12} /> : <UserCheck size={12} />}
                        onClick={() => toggleStatus(u)}
                      >
                        {u.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
