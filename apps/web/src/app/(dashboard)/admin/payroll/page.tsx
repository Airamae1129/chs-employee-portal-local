"use client";

import { useEffect, useState } from "react";
import { Trash2, Download, Eye, Check, Send, PlayCircle, Upload } from "lucide-react";
import { PageHeader, Card, Badge } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { apiFetch, API_URL } from "@/lib/api";
import { notifySuccess, notifyError, confirmAction } from "@/lib/alerts";

interface StaffUser {
  id: string;
  name: string;
  country: "IRELAND" | "PHILIPPINES";
}
interface GeneratedPayslip {
  id: string;
  userId: string;
  period: string;
  totalWorkHours: string;
  holidayPay: string;
  leaveUsedDays: string;
  daysPaid: string;
  workingDaysInPeriod: number;
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

export default function AdminPayrollPage() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [payslips, setPayslips] = useState<GeneratedPayslip[]>([]);
  const [running, setRunning] = useState(false);

  const [ieUserId, setIeUserId] = useState("");
  const [iePeriod, setIePeriod] = useState(period);
  const [ieFile, setIeFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ieUploads, setIeUploads] = useState<IrelandPayslip[]>([]);

  function refresh() {
    apiFetch<{ users: StaffUser[] }>("/users").then(({ users }) => setUsers(users));
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
          <div className="text-base font-bold text-chs-charcoal">Generated payslips — every active employee</div>
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
                <th className="py-2">Hours</th>
                <th className="py-2">Days paid</th>
                <th className="py-2">Holiday pay</th>
                <th className="py-2">Leave used</th>
                <th className="py-2">Net pay</th>
                <th className="py-2">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {payslips.map((p) => (
                <tr key={p.id} className="border-b border-gray-50">
                  <td className="py-2.5">{p.user?.name ?? userById.get(p.userId)?.name}</td>
                  <td className="py-2.5 text-gray-500">{Number(p.totalWorkHours).toFixed(1)}h</td>
                  <td className="py-2.5 text-gray-500">{p.daysPaid} / {p.workingDaysInPeriod}</td>
                  <td className="py-2.5 text-gray-500">
                    {CURRENCY_SYMBOL[p.currency] ?? ""}{Number(p.holidayPay).toLocaleString()}
                  </td>
                  <td className="py-2.5 text-gray-500">{p.leaveUsedDays}d</td>
                  <td className="py-2.5 font-semibold">
                    {CURRENCY_SYMBOL[p.currency] ?? ""}{Number(p.netPay).toLocaleString()}
                  </td>
                  <td className="py-2.5">
                    <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                  </td>
                  <td className="py-2.5 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {p.status === "DRAFT" && (
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
    </div>
  );
}
