"use client";

import { useEffect, useState } from "react";
import { Trash2, Download, Eye, Check, Send, PlayCircle, Upload, Save, MinusCircle } from "lucide-react";
import { PageHeader, Card, Badge } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { apiFetch, API_URL } from "@/lib/api";
import { notifySuccess, notifyError, confirmAction } from "@/lib/alerts";
import { useCurrentUser } from "@/lib/useCurrentUser";

interface StaffUser {
  id: string;
  name: string;
  country: "IRELAND" | "PHILIPPINES";
  jobTitle?: string | null;
  salary: string | null;
  allowances: string | null;
  salaryCurrency: string | null;
}
interface GeneratedPayslip {
  id: string;
  userId: string;
  period: string;
  workingDaysInPeriod: number;
  baseSalary: string;
  allowances: string;
  grossPay: string;
  unpaidLeaveDays: string;
  deductions: string;
  deductionNote: string | null;
  netPay: string;
  currency: string;
  status: "DRAFT" | "HR_REVIEW" | "APPROVED" | "PUBLISHED";
  user: { name: string; country: string };
}
interface IrelandPayslip {
  id: string;
  userId: string;
  period: string;
}

const STATUS_TONE: Record<string, "gray" | "gold" | "green" | "red"> = {
  DRAFT: "gray",
  HR_REVIEW: "gold",
  APPROVED: "gold",
  PUBLISHED: "green",
};
const CURRENCY_SYMBOL: Record<string, string> = { EUR: "€", PHP: "₱" };

function money(currency: string, value: string | number): string {
  return `${CURRENCY_SYMBOL[currency] ?? ""}${Number(value).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Payroll (Payroll role only — separate from Admin per the roles table):
 * salaries, payroll runs, approval/publishing, and Ireland payslip uploads.
 */
export default function AdminPayrollPage() {
  const { user: me } = useCurrentUser();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [salaryDraft, setSalaryDraft] = useState<Record<string, { salary: string; allowances: string }>>({});
  const [deductionFor, setDeductionFor] = useState<GeneratedPayslip | null>(null);
  const [deductionDays, setDeductionDays] = useState("");
  const [deductionAmount, setDeductionAmount] = useState("");
  const [deductionNote, setDeductionNote] = useState("");
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [payslips, setPayslips] = useState<GeneratedPayslip[]>([]);
  const [running, setRunning] = useState(false);

  const [ieUserId, setIeUserId] = useState("");
  const [iePeriod, setIePeriod] = useState(period);
  const [ieFile, setIeFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ieUploads, setIeUploads] = useState<IrelandPayslip[]>([]);

  // Staff + salaries load once (viewing them is audit-logged); payslips follow the period.
  function refreshStaff() {
    apiFetch<{ users: StaffUser[] }>("/payroll/staff").then(({ users }) => {
      setUsers(users);
      setSalaryDraft(Object.fromEntries(users.map((u) => [u.id, { salary: u.salary ?? "", allowances: u.allowances ?? "" }])));
    });
  }
  useEffect(refreshStaff, []);

  async function saveSalary(u: StaffUser) {
    const draft = salaryDraft[u.id];
    try {
      await apiFetch(`/payroll/salary/${u.id}`, {
        method: "PUT",
        body: JSON.stringify({ salary: Number(draft.salary), allowances: draft.allowances === "" ? undefined : Number(draft.allowances) }),
      });
      refreshStaff();
      notifySuccess("Salary saved", `${u.name}'s salary has been updated.`);
    } catch (e) {
      notifyError("Couldn't save salary", e instanceof Error ? e.message : undefined);
    }
  }

  function refresh() {
    apiFetch<{ payslips: GeneratedPayslip[] }>(`/payroll/summary?period=${period}`).then(({ payslips }) => setPayslips(payslips));
    apiFetch<{ ireland: IrelandPayslip[] }>("/payslips/team").then(({ ireland }) => setIeUploads(ireland.filter((p) => p.period === period)));
  }
  useEffect(refresh, [period]);

  async function runPayroll() {
    setRunning(true);
    try {
      const { payslips } = await apiFetch<{ payslips: any[] }>("/payroll/run", { method: "POST", body: JSON.stringify({ period }) });
      refresh();
      notifySuccess("Payroll run complete", `${payslips.length} payslip(s) generated for ${period}.`);
    } catch (e) {
      notifyError("Payroll run failed", e instanceof Error ? e.message : undefined);
    } finally {
      setRunning(false);
    }
  }

  function openDeduction(p: GeneratedPayslip) {
    setDeductionFor(p);
    setDeductionDays(Number(p.unpaidLeaveDays) ? String(Number(p.unpaidLeaveDays)) : "");
    setDeductionAmount(Number(p.deductions) ? String(Number(p.deductions)) : "");
    setDeductionNote(p.deductionNote ?? "");
  }

  async function saveDeduction() {
    if (!deductionFor) return;
    try {
      await apiFetch(`/payroll/${deductionFor.id}/deduction`, {
        method: "PATCH",
        body: JSON.stringify({ unpaidLeaveDays: Number(deductionDays || 0), amount: Number(deductionAmount || 0), note: deductionNote.trim() || undefined }),
      });
      setDeductionFor(null);
      refresh();
      notifySuccess("Deduction saved", "Net pay updated. The payslip is back in Draft for approval.");
    } catch (e) {
      notifyError("Couldn't save deduction", e instanceof Error ? e.message : undefined);
    }
  }

  async function approve(id: string) {
    await apiFetch(`/payroll/${id}/approve`, { method: "PATCH" });
    refresh();
  }
  async function publish(id: string) {
    await apiFetch(`/payroll/${id}/publish`, { method: "PATCH" });
    refresh();
    notifySuccess("Payslip published", "The PDF has been generated.");
  }
  async function openPdf(id: string, mode: "view" | "download") {
    const { fileUrl } = await apiFetch<{ fileUrl: string }>(`/payslips/ph/${id}/file`);
    window.open(mode === "download" ? `${fileUrl}&download=1` : fileUrl, "_blank", "noreferrer");
  }
  async function removeGenerated(id: string) {
    const ok = await confirmAction({ title: "Delete this payslip?", danger: true, confirmText: "Delete" });
    if (!ok) return;
    await apiFetch(`/payroll/${id}`, { method: "DELETE" });
    refresh();
  }
  async function removeUpload(id: string) {
    const ok = await confirmAction({ title: "Delete this uploaded payslip?", danger: true, confirmText: "Delete" });
    if (!ok) return;
    await apiFetch(`/payslips/ireland/${id}`, { method: "DELETE" });
    refresh();
  }

  async function uploadIrelandPayslip() {
    if (!ieFile || !ieUserId) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("userId", ieUserId);
      form.append("period", iePeriod);
      form.append("file", ieFile);
      const res = await fetch(`${API_URL}/payslips/ireland/upload`, { method: "POST", credentials: "include", body: form });
      if (!res.ok) throw new Error("Upload failed");
      setIeFile(null);
      refresh();
      notifySuccess("Payslip uploaded");
    } catch (e) {
      notifyError("Upload failed", e instanceof Error ? e.message : undefined);
    } finally {
      setUploading(false);
    }
  }

  const irelandUsers = users.filter((u) => u.country === "IRELAND");
  const userById = new Map(users.map((u) => [u.id, u]));

  return (
    <div>
      <PageHeader title="Payroll" />

      <Card className="mb-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-base font-bold text-chs-charcoal">Generated payslips — every active employee</div>
            <div className="text-xs text-gray-400">
              Fixed monthly salary, no attendance-based computation. Enter any unpaid leave deduction by hand before approving.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
            />
            <Button icon={<PlayCircle size={16} />} onClick={runPayroll} disabled={running}>
              {running ? "Running..." : "Run payroll for this period"}
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
                <th className="py-2">Employee</th>
                <th className="py-2">Working days</th>
                <th className="py-2">Monthly salary</th>
                <th className="py-2">Allowances</th>
                <th className="py-2">Unpaid leave deduction</th>
                <th className="py-2">Net pay</th>
                <th className="py-2">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {payslips.map((p) => (
                <tr key={p.id} className="border-b border-gray-50">
                  <td className="py-2.5">{p.user?.name ?? userById.get(p.userId)?.name}</td>
                  <td className="py-2.5 text-gray-500">{p.workingDaysInPeriod}</td>
                  <td className="py-2.5 text-gray-500">{money(p.currency, p.baseSalary)}</td>
                  <td className="py-2.5 text-gray-500">{Number(p.allowances) ? money(p.currency, p.allowances) : "—"}</td>
                  <td className="py-2.5 text-gray-500">
                    {Number(p.deductions) ? (
                      <div>
                        <span className="text-red-600">−{money(p.currency, p.deductions)}</span>
                        <span className="ml-1 text-xs text-gray-400">({Number(p.unpaidLeaveDays)}d)</span>
                        {p.deductionNote && <div className="max-w-[12rem] truncate text-xs text-gray-400" title={p.deductionNote}>{p.deductionNote}</div>}
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2.5 font-semibold">
                    {money(p.currency, p.netPay)}
                  </td>
                  <td className="py-2.5">
                    <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                  </td>
                  <td className="py-2.5 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {p.status !== "PUBLISHED" && p.userId !== me?.id && (
                        <Button size="sm" variant="secondary" icon={<MinusCircle size={13} />} onClick={() => openDeduction(p)}>
                          Deduction
                        </Button>
                      )}
                      {p.status === "DRAFT" && p.userId !== me?.id && (
                        <Button size="sm" variant="secondary" icon={<Check size={13} />} onClick={() => approve(p.id)}>
                          Approve
                        </Button>
                      )}
                      {p.status === "APPROVED" && (
                        <Button size="sm" variant="success" icon={<Send size={13} />} onClick={() => publish(p.id)}>
                          Publish
                        </Button>
                      )}
                      {p.status === "PUBLISHED" && (
                        <>
                          <Button size="sm" variant="secondary" icon={<Eye size={13} />} onClick={() => openPdf(p.id, "view")}>
                            View
                          </Button>
                          <Button size="sm" variant="secondary" icon={<Download size={13} />} onClick={() => openPdf(p.id, "download")}>
                            Download
                          </Button>
                        </>
                      )}
                      <button onClick={() => removeGenerated(p.id)} className="text-gray-300 hover:text-red-500" aria-label="Delete payslip">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {payslips.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-sm text-gray-400">
                    No payroll run for this period yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="mb-4 text-base font-bold text-chs-charcoal">Ireland — upload a payslip (optional override)</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-chs-charcoal">Employee</label>
            <select value={ieUserId} onChange={(e) => setIeUserId(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal">
              <option value="">Select...</option>
              {irelandUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-chs-charcoal">Period</label>
            <input type="month" value={iePeriod} onChange={(e) => setIePeriod(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-chs-charcoal">Payslip PDF</label>
            <input type="file" accept="application/pdf" onChange={(e) => setIeFile(e.target.files?.[0] ?? null)} className="w-full text-sm" />
          </div>
        </div>
        <Button icon={<Upload size={16} />} onClick={uploadIrelandPayslip} disabled={uploading || !ieFile || !ieUserId} className="mt-4">
          {uploading ? "Uploading..." : "Upload payslip"}
        </Button>

        {ieUploads.length > 0 && (
          <div className="mt-6 divide-y divide-gray-50">
            {ieUploads.map((u) => (
              <div key={u.id} className="flex items-center justify-between py-2 text-sm">
                <span>{userById.get(u.userId)?.name ?? u.userId} — {u.period}</span>
                <button onClick={() => removeUpload(u.id)} className="text-gray-300 hover:text-red-500" aria-label="Delete upload">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {deductionFor && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <Card className="w-full max-w-sm">
            <div className="text-base font-bold text-chs-charcoal">Unpaid leave deduction</div>
            <div className="mt-1 text-xs text-gray-500">
              {deductionFor.user?.name ?? userById.get(deductionFor.userId)?.name} · {deductionFor.period} · monthly salary{" "}
              {money(deductionFor.currency, deductionFor.baseSalary)} over {deductionFor.workingDaysInPeriod} working days (
              {money(deductionFor.currency, Number(deductionFor.baseSalary) / deductionFor.workingDaysInPeriod)} per day, for reference)
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Unpaid leave days</label>
                <input
                  type="number"
                  min={0}
                  max={31}
                  step={0.5}
                  value={deductionDays}
                  onChange={(e) => setDeductionDays(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">
                  Deduction amount ({deductionFor.currency === "EUR" ? "EUR" : "PHP"})
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={deductionAmount}
                  onChange={(e) => setDeductionAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
                />
                <p className="mt-1 text-xs text-gray-400">Calculated by you — it isn't computed automatically.</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Note (shown on the payslip)</label>
                <input
                  value={deductionNote}
                  onChange={(e) => setDeductionNote(e.target.value)}
                  placeholder="e.g. Unpaid leave 14-15 Oct"
                  maxLength={300}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
                />
              </div>
              <div className="rounded-lg bg-chs-bg px-3 py-2 text-sm text-chs-charcoal">
                Net pay: <span className="font-semibold">{money(deductionFor.currency, Number(deductionFor.grossPay) - Number(deductionAmount || 0))}</span>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeductionFor(null)}>Cancel</Button>
              <Button
                icon={<Save size={14} />}
                onClick={saveDeduction}
                disabled={Number(deductionAmount || 0) < 0 || Number(deductionAmount || 0) > Number(deductionFor.grossPay)}
              >
                Save deduction
              </Button>
            </div>
          </Card>
        </div>
      )}

      <Card className="mt-6">
        <div className="mb-1 text-base font-bold text-chs-charcoal">Salaries</div>
        <p className="mb-4 text-xs text-gray-400">
          Monthly base salary and allowances used by payroll runs. Only Payroll can see or change these, every view and change is recorded
          in the audit log, and nobody can change their own salary.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
                <th className="py-2">Employee</th>
                <th className="py-2">Country</th>
                <th className="py-2">Monthly salary</th>
                <th className="py-2">Allowances</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === me?.id;
                const draft = salaryDraft[u.id] ?? { salary: "", allowances: "" };
                const currency = u.country === "IRELAND" ? "EUR" : "PHP";
                const changed = draft.salary !== (u.salary ?? "") || draft.allowances !== (u.allowances ?? "");
                return (
                  <tr key={u.id} className="border-b border-gray-50">
                    <td className="py-2.5">
                      {u.name}
                      {u.jobTitle ? <span className="ml-1.5 text-xs text-gray-400">{u.jobTitle}</span> : null}
                    </td>
                    <td className="py-2.5 text-gray-500">{u.country}</td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-400">{CURRENCY_SYMBOL[currency]}</span>
                        <input
                          type="number"
                          min={0}
                          disabled={self}
                          value={draft.salary}
                          onChange={(e) => setSalaryDraft({ ...salaryDraft, [u.id]: { ...draft, salary: e.target.value } })}
                          placeholder="Not set"
                          className="w-32 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-chs-charcoal disabled:bg-gray-50 disabled:text-gray-400"
                        />
                      </div>
                    </td>
                    <td className="py-2.5">
                      <input
                        type="number"
                        min={0}
                        disabled={self}
                        value={draft.allowances}
                        onChange={(e) => setSalaryDraft({ ...salaryDraft, [u.id]: { ...draft, allowances: e.target.value } })}
                        placeholder="0"
                        className="w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-chs-charcoal disabled:bg-gray-50 disabled:text-gray-400"
                      />
                    </td>
                    <td className="py-2.5 text-right">
                      {self ? (
                        <span className="text-xs text-gray-400">Set by another Payroll user</span>
                      ) : (
                        <Button size="sm" variant="secondary" icon={<Save size={12} />} onClick={() => saveSalary(u)} disabled={!changed || !(Number(draft.salary) > 0)}>
                          Save
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
