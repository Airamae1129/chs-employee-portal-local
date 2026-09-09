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

const CURRENCY_SYMBOL: Record<string, string> = { EUR: "€", PHP: "₱" };

export default function PayslipsPage() {
  const { user } = useCurrentUser();
  const [uploaded, setUploaded] = useState<IrelandPayslip[]>([]);
  const [generated, setGenerated] = useState<GeneratedPayslip[]>([]);
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    if (!user) return;
    // Admin: every employee's payslips (Payslips revision — "List of ALL
    // Generated payslips for all Users"). Employee/Manager: own only, no
    // access to anyone else's — enforced server-side either way.
    const endpoint = isAdmin ? "/payslips/all" : "/payslips/me";
    apiFetch<{ uploaded: IrelandPayslip[]; generated: GeneratedPayslip[] }>(endpoint).then(({ uploaded, generated }) => {
      setUploaded(uploaded);
      setGenerated(generated);
    });
  }, [user, isAdmin]);

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

      <Card className="mb-6">
        <div className="mb-4 text-base font-bold text-chs-charcoal">
          {isAdmin ? "Generated payslips — all employees" : "Generated payslips"}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
                {isAdmin && <th className="py-2">Employee</th>}
                <th className="py-2">Period</th>
                <th className="py-2">Net pay</th>
                <th className="py-2">Published</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {generated.map((p) => (
                <tr key={p.id} className="border-b border-gray-50">
                  {isAdmin && <td className="py-2.5">{p.user?.name ?? "—"}</td>}
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
                  <td colSpan={isAdmin ? 5 : 4} className="py-4 text-sm text-gray-400">
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
            <Badge tone="gray">Admin override</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
                  {isAdmin && <th className="py-2">Employee</th>}
                  <th className="py-2">Period</th>
                  <th className="py-2">Uploaded</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {uploaded.map((p) => (
                  <tr key={p.id} className="border-b border-gray-50">
                    {isAdmin && <td className="py-2.5">{p.user?.name ?? "—"}</td>}
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
