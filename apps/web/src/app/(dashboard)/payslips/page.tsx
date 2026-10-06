"use client";

import { useEffect, useState } from "react";
import { Eye, Download } from "lucide-react";
import { PageHeader, Card, Badge } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { notifyError } from "@/lib/alerts";

interface IrelandPayslip {
  id: string;
  period: string;
  uploadedAt: string;
  user?: { name: string } | null;
}
interface GeneratedPayslip {
  id: string;
  period: string;
  netPay: string;
  currency: string;
  publishedAt: string;
  user?: { name: string } | null;
}

interface MySalary {
  baseRate: string;
  allowances: string;
  currency: string;
  updatedAt: string;
}

const CURRENCY_SYMBOL: Record<string, string> = { EUR: "€", PHP: "₱" };

export default function PayslipsPage() {
  const { user } = useCurrentUser();
  const [uploaded, setUploaded] = useState<IrelandPayslip[]>([]);
  const [generated, setGenerated] = useState<GeneratedPayslip[]>([]);
  const [mySalary, setMySalary] = useState<MySalary | null | undefined>(undefined);
  // Roles table: only Payroll views other people's payslips; everyone else,
  // Admin included, sees their own — enforced server-side either way.
  const seesAll = user?.role === "PAYROLL";

  useEffect(() => {
    if (!user) return;
    const endpoint = seesAll ? "/payslips/all" : "/payslips/me";
    apiFetch<{ uploaded: IrelandPayslip[]; generated: GeneratedPayslip[] }>(endpoint).then(({ uploaded, generated }) => {
      setUploaded(uploaded);
      setGenerated(generated);
    });
    apiFetch<{ salary: MySalary | null }>("/me/salary")
      .then(({ salary }) => setMySalary(salary))
      .catch(() => setMySalary(null));
  }, [user, seesAll]);

  async function openFile(kind: "ireland" | "ph", id: string, mode: "view" | "download") {
    try {
      const { fileUrl } = await apiFetch<{ fileUrl: string }>(`/payslips/${kind}/${id}/file`);
      const url = mode === "download" ? `${fileUrl}&download=1` : fileUrl;
      window.open(url, "_blank", "noreferrer");
    } catch (e) {
      notifyError("Couldn't open payslip", e instanceof Error ? e.message : undefined);
    }
  }

  if (!user) return null;

  return (
    <div>
      <PageHeader title="Payslips" />

      {mySalary !== undefined && (
        <Card className="mb-6">
          <div className="text-sm text-gray-500">My salary</div>
          {mySalary ? (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-2xl font-bold text-chs-charcoal">
                {CURRENCY_SYMBOL[mySalary.currency] ?? ""}{Number(mySalary.baseRate).toLocaleString()}
                <span className="ml-1 text-sm font-normal text-gray-400">/ month</span>
              </span>
              {Number(mySalary.allowances) > 0 && (
                <span className="text-sm text-gray-500">
                  + {CURRENCY_SYMBOL[mySalary.currency] ?? ""}{Number(mySalary.allowances).toLocaleString()} allowances
                </span>
              )}
            </div>
          ) : (
            <div className="mt-1 text-sm text-gray-400">Not set yet — Payroll sets salaries.</div>
          )}
        </Card>
      )}

      <Card className="mb-6">
        <div className="mb-4 text-base font-bold text-chs-charcoal">
          {seesAll ? "Generated payslips — all employees" : "Generated payslips"}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
                {seesAll && <th className="py-2">Employee</th>}
                <th className="py-2">Period</th>
                <th className="py-2">Net pay</th>
                <th className="py-2">Published</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {generated.map((p) => (
                <tr key={p.id} className="border-b border-gray-50">
                  {seesAll && <td className="py-2.5">{p.user?.name ?? "—"}</td>}
                  <td className="py-2.5">{p.period}</td>
                  <td className="py-2.5 font-semibold">
                    {CURRENCY_SYMBOL[p.currency] ?? ""}{Number(p.netPay).toLocaleString()}
                  </td>
                  <td className="py-2.5 text-gray-500">{new Date(p.publishedAt).toLocaleDateString()}</td>
                  <td className="py-2.5 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Button size="sm" variant="secondary" icon={<Eye size={13} />} onClick={() => openFile("ph", p.id, "view")}>
                        View
                      </Button>
                      <Button size="sm" variant="secondary" icon={<Download size={13} />} onClick={() => openFile("ph", p.id, "download")}>
                        Download
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {generated.length === 0 && (
                <tr>
                  <td colSpan={seesAll ? 5 : 4} className="py-4 text-sm text-gray-400">
                    No published payslips yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {uploaded.length > 0 && (
        <Card>
          <div className="mb-4 flex items-center gap-2 text-base font-bold text-chs-charcoal">
            Uploaded payslips
            <Badge tone="gray">Uploaded by Payroll</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
                  {seesAll && <th className="py-2">Employee</th>}
                  <th className="py-2">Period</th>
                  <th className="py-2">Uploaded</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {uploaded.map((p) => (
                  <tr key={p.id} className="border-b border-gray-50">
                    {seesAll && <td className="py-2.5">{p.user?.name ?? "—"}</td>}
                    <td className="py-2.5">{p.period}</td>
                    <td className="py-2.5 text-gray-500">{new Date(p.uploadedAt).toLocaleDateString()}</td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Button size="sm" variant="secondary" icon={<Eye size={13} />} onClick={() => openFile("ireland", p.id, "view")}>
                          View
                        </Button>
                        <Button size="sm" variant="secondary" icon={<Download size={13} />} onClick={() => openFile("ireland", p.id, "download")}>
                          Download
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
