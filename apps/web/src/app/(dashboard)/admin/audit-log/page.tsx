"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card } from "@/components/PageHeader";
import { apiFetch } from "@/lib/api";

interface AuditEntry {
  id: string;
  action: string;
  targetId?: string;
  timestamp: string;
  user?: { name: string; email: string } | null;
  metadata?: Record<string, unknown>;
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [actionFilter, setActionFilter] = useState("");

  useEffect(() => {
    const qs = actionFilter ? `?action=${encodeURIComponent(actionFilter)}` : "";
    apiFetch<{ entries: AuditEntry[] }>(`/audit-log${qs}`).then(({ entries }) => setEntries(entries));
  }, [actionFilter]);

  return (
    <div>
      <PageHeader title="Audit Log" />

      <div className="mb-6">
        <input
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          placeholder="Filter by action, e.g. PayslipViewed"
          className="w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <Card>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
              <th className="py-2">Timestamp</th>
              <th className="py-2">Actor</th>
              <th className="py-2">Action</th>
              <th className="py-2">Target</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-gray-50 align-top">
                <td className="py-2.5 text-gray-500">{new Date(e.timestamp).toLocaleString()}</td>
                <td className="py-2.5">{e.user?.name ?? "System"}</td>
                <td className="py-2.5 font-medium">{e.action}</td>
                <td className="py-2.5 text-xs text-gray-400">{e.targetId ?? "—"}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-sm text-gray-400">
                  No matching audit entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
