"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Check, X, Send, Upload, Eye, Download, CalendarOff } from "lucide-react";
import { PageHeader, Card, Badge } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { apiFetch, API_URL } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { notifySuccess, notifyError } from "@/lib/alerts";

interface HRRequest {
  id: string;
  requestType: "LEAVE" | "COE" | "HR_LETTER" | "OTHER";
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED";
  submissionDate: string;
  startDate?: string;
  endDate?: string;
  leaveType?: string;
  comments?: string;
  fileKey?: string | null;
  employee?: { id: string; name: string; email: string };
}

const STATUS_TONE: Record<string, "gray" | "gold" | "green" | "red"> = {
  SUBMITTED: "gold",
  APPROVED: "green",
  REJECTED: "red",
  CANCELLED: "gray",
};

const DOCUMENT_TYPES: HRRequest["requestType"][] = ["COE", "HR_LETTER"];

interface LeaveBalance {
  total: number;
  used: number;
  remaining: number;
}

export default function HRRequestsPage() {
  const { user } = useCurrentUser();
  const [myRequests, setMyRequests] = useState<HRRequest[]>([]);
  const [teamRequests, setTeamRequests] = useState<HRRequest[]>([]);
  const [leaveBalance, setLeaveBalance] = useState<LeaveBalance | null>(null);
  const [teamBalances, setTeamBalances] = useState<Record<string, LeaveBalance>>({});
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [requestType, setRequestType] = useState<HRRequest["requestType"]>("LEAVE");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [leaveType, setLeaveType] = useState("Annual Leave");
  const [comments, setComments] = useState("");

  function refresh() {
    apiFetch<{ requests: HRRequest[] }>("/hr-requests/me").then(({ requests }) => setMyRequests(requests));
    apiFetch<{ balance: LeaveBalance }>("/hr-requests/leave-balance").then(({ balance }) => setLeaveBalance(balance));
    if (user?.role === "MANAGER" || user?.role === "ADMIN") {
      apiFetch<{ requests: HRRequest[] }>("/hr-requests/team").then(({ requests }) => setTeamRequests(requests));
      apiFetch<{ balances: (LeaveBalance & { userId: string })[] }>("/hr-requests/leave-balance/team").then(({ balances }) =>
        setTeamBalances(Object.fromEntries(balances.map((b) => [b.userId, b])))
      );
    }
  }

  useEffect(() => {
    if (user) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function submitRequest() {
    setSubmitting(true);
    try {
      await apiFetch("/hr-requests", {
        method: "POST",
        body: JSON.stringify({
          requestType,
          ...(requestType === "LEAVE" ? { startDate, endDate, leaveType, payType: "PAID" } : {}),
          comments,
        }),
      });
      setShowForm(false);
      setComments("");
      refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function decide(id: string, decision: "APPROVED" | "REJECTED") {
    try {
      await apiFetch(`/hr-requests/${id}/decision`, { method: "PATCH", body: JSON.stringify({ decision }) });
      refresh();
      notifySuccess(decision === "APPROVED" ? "Request approved" : "Request rejected");
    } catch (e) {
      notifyError("Couldn't update request", e instanceof Error ? e.message : undefined);
    }
  }

  async function uploadDocument(id: string, file: File) {
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_URL}/hr-requests/${id}/upload`, { method: "POST", credentials: "include", body: form });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Upload failed");
      refresh();
      notifySuccess("Document uploaded", "The employee can now view and download it.");
    } catch (e) {
      notifyError("Couldn't upload document", e instanceof Error ? e.message : undefined);
    }
  }

  async function openDocument(id: string, mode: "view" | "download") {
    try {
      const { fileUrl } = await apiFetch<{ fileUrl: string }>(`/hr-requests/${id}/file`);
      window.open(mode === "download" ? `${fileUrl}&download=1` : fileUrl, "_blank", "noreferrer");
    } catch (e) {
      notifyError("Couldn't open document", e instanceof Error ? e.message : undefined);
    }
  }

  if (!user) return null;

  return (
    <div>
      <PageHeader
        title="HR Requests"
        action={
          <Button icon={<Plus size={16} />} onClick={() => setShowForm(true)}>
            New request
          </Button>
        }
      />

      {showForm && (
        <Card className="mb-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Request type</label>
              <select
                value={requestType}
                onChange={(e) => setRequestType(e.target.value as HRRequest["requestType"])}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="LEAVE">Leave</option>
                <option value="COE">Certificate of Employment</option>
                <option value="HR_LETTER">HR Letter</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            {requestType === "LEAVE" && (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium">Leave type</label>
                  <input
                    value={leaveType}
                    onChange={(e) => setLeaveType(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Start date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">End date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              </>
            )}
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium">Comments</label>
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button icon={<Send size={14} />} onClick={submitRequest} disabled={submitting}>
              {submitting ? "Submitting..." : "Submit"}
            </Button>
          </div>
        </Card>
      )}

      <Card className="mb-6 flex items-center gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-chs-badge">
          <CalendarOff size={20} className="text-chs-charcoal" />
        </div>
        <div>
          <div className="text-lg font-bold text-chs-charcoal">
            {leaveBalance ? leaveBalance.remaining : "—"} <span className="text-sm font-normal text-gray-400">/ {leaveBalance?.total ?? 12} paid leave days left this year</span>
          </div>
          <div className="text-xs text-gray-400">
            {leaveBalance ? `${leaveBalance.used} used` : "Loading..."} — reduces only once a leave request is approved.
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-4 text-base font-bold text-chs-charcoal">My requests</div>
        <RequestTable requests={myRequests} onOpenDocument={openDocument} />
      </Card>

      {(user.role === "MANAGER" || user.role === "ADMIN") && (
        <Card className="mt-6">
          <div className="mb-4 text-base font-bold text-chs-charcoal">
            {user.role === "ADMIN" ? "All requests" : "My team's requests"}
          </div>
          <RequestTable
            requests={teamRequests}
            showEmployee
            onDecide={decide}
            onOpenDocument={openDocument}
            onUpload={uploadDocument}
            teamBalances={teamBalances}
          />
        </Card>
      )}
    </div>
  );
}

function RequestTable({
  requests,
  showEmployee,
  onDecide,
  onOpenDocument,
  onUpload,
  teamBalances,
}: {
  requests: HRRequest[];
  showEmployee?: boolean;
  onDecide?: (id: string, decision: "APPROVED" | "REJECTED") => void;
  onOpenDocument: (id: string, mode: "view" | "download") => void;
  onUpload?: (id: string, file: File) => void;
  teamBalances?: Record<string, LeaveBalance>;
}) {
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  if (requests.length === 0) return <div className="text-sm text-gray-400">No requests yet.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
            {showEmployee && <th className="py-2">Employee</th>}
            <th className="py-2">Type</th>
            <th className="py-2">Dates</th>
            <th className="py-2">Submitted</th>
            <th className="py-2">Status</th>
            <th className="py-2">Document</th>
            {onDecide && <th className="py-2">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => {
            const isDocumentType = DOCUMENT_TYPES.includes(r.requestType);
            return (
              <tr key={r.id} className="border-b border-gray-50">
                {showEmployee && (
                  <td className="py-2.5">
                    <div>{r.employee?.name}</div>
                    {r.employee && teamBalances?.[r.employee.id] && (
                      <div className="text-[11px] text-gray-400">
                        {teamBalances[r.employee.id].remaining}/{teamBalances[r.employee.id].total} leave days left
                      </div>
                    )}
                  </td>
                )}
                <td className="py-2.5">{r.requestType.replace("_", " ")}</td>
                <td className="py-2.5 text-gray-500">
                  {r.startDate ? `${r.startDate.slice(0, 10)} → ${r.endDate?.slice(0, 10)}` : "—"}
                </td>
                <td className="py-2.5 text-gray-500">{new Date(r.submissionDate).toLocaleDateString()}</td>
                <td className="py-2.5">
                  <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                </td>
                <td className="py-2.5">
                  {!isDocumentType ? (
                    <span className="text-xs text-gray-300">—</span>
                  ) : r.fileKey ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" icon={<Eye size={12} />} onClick={() => onOpenDocument(r.id, "view")}>
                        View
                      </Button>
                      <Button size="sm" variant="secondary" icon={<Download size={12} />} onClick={() => onOpenDocument(r.id, "download")}>
                        Download
                      </Button>
                    </div>
                  ) : onUpload ? (
                    <>
                      <input
                        ref={(el) => {
                          fileInputs.current[r.id] = el;
                        }}
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) onUpload(r.id, file);
                          e.target.value = "";
                        }}
                      />
                      <Button size="sm" variant="secondary" icon={<Upload size={12} />} onClick={() => fileInputs.current[r.id]?.click()}>
                        Upload file
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-gray-400">Not uploaded yet</span>
                  )}
                </td>
                {onDecide && (
                  <td className="py-2.5">
                    {r.status === "SUBMITTED" ? (
                      <div className="flex gap-2">
                        <Button size="sm" variant="success" icon={<Check size={13} />} onClick={() => onDecide(r.id, "APPROVED")}>
                          Approve
                        </Button>
                        <Button size="sm" variant="destructive" icon={<X size={13} />} onClick={() => onDecide(r.id, "REJECTED")}>
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
