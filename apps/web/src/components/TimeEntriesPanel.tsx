"use client";

import { useEffect, useState } from "react";
import { Check, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { Card, Badge } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { apiFetch } from "@/lib/api";
import { notifyError, notifySuccess, confirmAction } from "@/lib/alerts";
import { CurrentUser } from "@/lib/types";

interface TimeEvent {
  id: string;
  eventType: "IN" | "OUT";
  timestamp: string;
  status: string;
}
interface CorrectionRequest {
  id: string;
  userId: string;
  userName?: string;
  action: "ADD" | "EDIT" | "DELETE";
  timeEventId: string | null;
  eventType: "IN" | "OUT" | null;
  requestedTimestamp: string | null;
  originalTimestamp: string | null;
  reason: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED";
  decidedByName?: string | null;
  decisionNote: string | null;
  createdAt: string;
}
interface Person {
  id: string;
  name: string;
}

/**
 * Time entries, per the roles table:
 * - Your own entries can't be edited directly. You request a change (add,
 *   change the time, or remove) with a reason, and your manager or an
 *   Admin approves it.
 * - Managers (their team) and Admins (anyone else) approve those requests
 *   and can edit another person's entries — with a reason, never their own.
 */
type Dialog =
  | { kind: "request-add" }
  | { kind: "request-edit"; event: TimeEvent }
  | { kind: "request-delete"; event: TimeEvent }
  | { kind: "other-add" }
  | { kind: "other-edit"; event: TimeEvent }
  | { kind: "other-delete"; event: TimeEvent };

const STATUS_TONE: Record<CorrectionRequest["status"], "gray" | "gold" | "green" | "red"> = {
  SUBMITTED: "gold",
  APPROVED: "green",
  REJECTED: "red",
  CANCELLED: "gray",
};
const STATUS_LABEL: Record<CorrectionRequest["status"], string> = {
  SUBMITTED: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export function TimeEntriesPanel({ user, monthDate, onChanged }: { user: CurrentUser; monthDate: Date; onChanged: () => void }) {
  const canApprove = user.role === "MANAGER" || user.role === "ADMIN";
  const monthLabel = monthDate.toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" });
  const range = () => {
    const from = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1));
    const to = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0, 23, 59, 59));
    return `${from.toISOString()},${to.toISOString()}`;
  };

  const [myEvents, setMyEvents] = useState<TimeEvent[]>([]);
  const [myRequests, setMyRequests] = useState<CorrectionRequest[]>([]);
  const [pending, setPending] = useState<CorrectionRequest[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [personId, setPersonId] = useState("");
  const [personEvents, setPersonEvents] = useState<TimeEvent[]>([]);

  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [eventType, setEventType] = useState<"IN" | "OUT">("IN");
  const [dateTime, setDateTime] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  function loadMine() {
    apiFetch<{ events: TimeEvent[] }>(`/time/me?range=${range()}`).then(({ events }) => setMyEvents(events)).catch(() => void 0);
    apiFetch<{ requests: CorrectionRequest[] }>("/time/corrections/me").then(({ requests }) => setMyRequests(requests)).catch(() => void 0);
  }
  function loadApprovals() {
    if (!canApprove) return;
    apiFetch<{ requests: CorrectionRequest[] }>("/time/corrections/pending").then(({ requests }) => setPending(requests)).catch(() => void 0);
  }
  function loadPerson(id = personId) {
    if (!canApprove || !id) return;
    apiFetch<{ events: TimeEvent[] }>(`/time/user/${id}?range=${range()}`).then(({ events }) => setPersonEvents(events)).catch(() => void 0);
  }

  useEffect(() => {
    loadMine();
    loadPerson();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthDate]);

  useEffect(() => {
    loadApprovals();
    if (canApprove) {
      apiFetch<{ users: Person[] }>("/time/editable-users").then(({ users }) => setPeople(users)).catch(() => void 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canApprove]);

  useEffect(() => {
    loadPerson(personId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId]);

  function open(d: Dialog) {
    setDialog(d);
    setReason("");
    setEventType("IN");
    setDateTime("event" in d && d.kind.endsWith("edit") ? toLocalInputValue(d.event.timestamp) : "");
  }

  async function submit() {
    if (!dialog) return;
    setBusy(true);
    try {
      const ts = dateTime ? new Date(dateTime).toISOString() : undefined;
      switch (dialog.kind) {
        case "request-add":
          await apiFetch("/time/corrections", { method: "POST", body: JSON.stringify({ action: "ADD", eventType, timestamp: ts, reason }) });
          break;
        case "request-edit":
          await apiFetch("/time/corrections", { method: "POST", body: JSON.stringify({ action: "EDIT", timeEventId: dialog.event.id, timestamp: ts, reason }) });
          break;
        case "request-delete":
          await apiFetch("/time/corrections", { method: "POST", body: JSON.stringify({ action: "DELETE", timeEventId: dialog.event.id, reason }) });
          break;
        case "other-add":
          await apiFetch("/time/entries", { method: "POST", body: JSON.stringify({ userId: personId, eventType, timestamp: ts, reason }) });
          break;
        case "other-edit":
          await apiFetch(`/time/entries/${dialog.event.id}`, { method: "PATCH", body: JSON.stringify({ timestamp: ts, reason }) });
          break;
        case "other-delete":
          await apiFetch(`/time/entries/${dialog.event.id}`, { method: "DELETE", body: JSON.stringify({ reason }) });
          break;
      }
      const isRequest = dialog.kind.startsWith("request");
      setDialog(null);
      loadMine();
      loadPerson();
      onChanged();
      notifySuccess(isRequest ? "Request sent" : "Entry updated", isRequest ? "Your manager or an Admin will review it." : "The change and your reason are in the audit log.");
    } catch (e) {
      notifyError("Couldn't save", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest(id: string) {
    const ok = await confirmAction({ title: "Cancel this request?", confirmText: "Cancel request" });
    if (!ok) return;
    try {
      await apiFetch(`/time/corrections/${id}/cancel`, { method: "POST" });
      loadMine();
    } catch (e) {
      notifyError("Couldn't cancel", e instanceof Error ? e.message : undefined);
    }
  }

  async function decide(r: CorrectionRequest, decision: "APPROVED" | "REJECTED") {
    const ok = await confirmAction({
      title: decision === "APPROVED" ? `Approve ${r.userName}'s correction?` : `Reject ${r.userName}'s correction?`,
      text: decision === "APPROVED" ? "The change is applied to their time entries." : undefined,
      confirmText: decision === "APPROVED" ? "Approve" : "Reject",
      danger: decision === "REJECTED",
    });
    if (!ok) return;
    try {
      await apiFetch(`/time/corrections/${r.id}/decision`, { method: "PATCH", body: JSON.stringify({ decision }) });
      loadApprovals();
      loadPerson();
      notifySuccess(decision === "APPROVED" ? "Correction approved" : "Correction rejected");
    } catch (e) {
      notifyError("Couldn't save decision", e instanceof Error ? e.message : undefined);
    }
  }

  const pendingFor = new Set(myRequests.filter((r) => r.status === "SUBMITTED" && r.timeEventId).map((r) => r.timeEventId));
  const needsTime = dialog && !dialog.kind.endsWith("delete");
  const needsType = dialog && dialog.kind.endsWith("add");
  const reasonOk = reason.trim().length >= 3;

  return (
    <>
      <Card className="mt-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-base font-bold text-chs-charcoal">My time entries</div>
            <div className="text-xs text-gray-400">
              {monthLabel}. To fix an entry, send a correction request with a reason — your manager or an Admin approves it.
            </div>
          </div>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => open({ kind: "request-add" })}>
            Request missing entry
          </Button>
        </div>
        <EntriesTable
          events={myEvents}
          empty="No time entries this month."
          renderActions={(e) =>
            pendingFor.has(e.id) ? (
              <Badge tone="gold">Change pending</Badge>
            ) : (
              <>
                <Button size="sm" variant="secondary" icon={<Pencil size={12} />} onClick={() => open({ kind: "request-edit", event: e })}>
                  Request change
                </Button>
                <Button size="sm" variant="secondary" icon={<Trash2 size={12} />} onClick={() => open({ kind: "request-delete", event: e })}>
                  Request removal
                </Button>
              </>
            )
          }
        />

        {myRequests.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-sm font-semibold text-chs-charcoal">My correction requests</div>
            <div className="space-y-2">
              {myRequests.slice(0, 10).map((r) => (
                <div key={r.id} className="flex flex-col gap-2 rounded-lg bg-chs-bg px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-chs-charcoal">{describe(r)}</div>
                    <div className="text-xs text-gray-500">
                      Reason: {r.reason}
                      {r.decidedByName ? ` · ${STATUS_LABEL[r.status].toLowerCase()} by ${r.decidedByName}` : ""}
                      {r.decisionNote ? ` — ${r.decisionNote}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    {r.status === "SUBMITTED" && (
                      <Button size="sm" variant="ghost" onClick={() => cancelRequest(r.id)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {canApprove && (
        <Card className="mt-6">
          <div className="mb-1 text-base font-bold text-chs-charcoal">Correction requests to approve</div>
          <p className="mb-4 text-xs text-gray-400">
            {user.role === "MANAGER" ? "From your team." : "From everyone else."} Your own requests are approved by someone else.
          </p>
          <div className="space-y-2">
            {pending.map((r) => (
              <div key={r.id} className="flex flex-col gap-2 rounded-lg bg-chs-bg px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-chs-charcoal">
                    <span className="font-medium">{r.userName}</span> — {describe(r)}
                  </div>
                  <div className="text-xs text-gray-500">Reason: {r.reason}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="success" icon={<Check size={12} />} onClick={() => decide(r, "APPROVED")}>
                    Approve
                  </Button>
                  <Button size="sm" variant="destructive" icon={<X size={12} />} onClick={() => decide(r, "REJECTED")}>
                    Reject
                  </Button>
                </div>
              </div>
            ))}
            {pending.length === 0 && <div className="text-sm text-gray-400">Nothing waiting for you.</div>}
          </div>
        </Card>
      )}

      {canApprove && people.length > 0 && (
        <Card className="mt-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-base font-bold text-chs-charcoal">
                {user.role === "MANAGER" ? "Edit a team member's entries" : "Edit someone's entries"}
              </div>
              <div className="text-xs text-gray-400">{monthLabel}. Every change needs a reason and is recorded in the audit log.</div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
              >
                <option value="">Select a person...</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {personId && (
                <Button size="sm" icon={<Plus size={14} />} onClick={() => open({ kind: "other-add" })}>
                  Add entry
                </Button>
              )}
            </div>
          </div>
          {personId && (
            <EntriesTable
              events={personEvents}
              empty="No time entries this month."
              renderActions={(e) => (
                <>
                  <Button size="sm" variant="secondary" icon={<Pencil size={12} />} onClick={() => open({ kind: "other-edit", event: e })}>
                    Edit
                  </Button>
                  <Button size="sm" variant="destructive" icon={<Trash2 size={12} />} onClick={() => open({ kind: "other-delete", event: e })}>
                    Delete
                  </Button>
                </>
              )}
            />
          )}
        </Card>
      )}

      {dialog && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <Card className="w-full max-w-sm">
            <div className="text-base font-bold text-chs-charcoal">{dialogTitle(dialog, people.find((p) => p.id === personId)?.name)}</div>
            {"event" in dialog && (
              <div className="mt-1 text-xs text-gray-500">
                Current: {dialog.event.eventType === "IN" ? "Clock In" : "Clock Out"} · {new Date(dialog.event.timestamp).toLocaleString()}
              </div>
            )}
            <div className="mt-4 space-y-3">
              {needsType && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-chs-charcoal">Type</label>
                  <select
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value as "IN" | "OUT")}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
                  >
                    <option value="IN">Clock In</option>
                    <option value="OUT">Clock Out</option>
                  </select>
                </div>
              )}
              {needsTime && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-chs-charcoal">{dialog.kind.endsWith("edit") ? "Correct date & time" : "Date & time"}</label>
                  <input
                    type="datetime-local"
                    value={dateTime}
                    onChange={(e) => setDateTime(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
                  />
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Reason (required)</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. Forgot to clock out — left at 17:30"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                variant={dialog.kind === "other-delete" ? "destructive" : "primary"}
                icon={dialog.kind.startsWith("request") ? <Send size={14} /> : dialog.kind === "other-delete" ? <Trash2 size={14} /> : <Check size={14} />}
                onClick={submit}
                disabled={busy || !reasonOk || (!!needsTime && !dateTime)}
              >
                {dialog.kind.startsWith("request") ? "Send request" : dialog.kind === "other-delete" ? "Delete entry" : "Save"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function EntriesTable({ events, empty, renderActions }: { events: TimeEvent[]; empty: string; renderActions: (e: TimeEvent) => React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
            <th className="py-2">Type</th>
            <th className="py-2">Timestamp</th>
            <th className="py-2">Status</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-b border-gray-50">
              <td className="py-2.5">{e.eventType === "IN" ? "Clock In" : "Clock Out"}</td>
              <td className="py-2.5 text-gray-500">{new Date(e.timestamp).toLocaleString()}</td>
              <td className="py-2.5 text-gray-500">{e.status}</td>
              <td className="py-2.5 text-right">
                <div className="flex items-center justify-end gap-2">{renderActions(e)}</div>
              </td>
            </tr>
          ))}
          {events.length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-sm text-gray-400">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function describe(r: CorrectionRequest): string {
  const type = r.eventType === "OUT" ? "clock-out" : "clock-in";
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
  if (r.action === "ADD") return `Add a missing ${type} at ${fmt(r.requestedTimestamp)}`;
  if (r.action === "EDIT") return `Change ${type} from ${fmt(r.originalTimestamp)} to ${fmt(r.requestedTimestamp)}`;
  return `Remove ${type} at ${fmt(r.originalTimestamp)}`;
}

function dialogTitle(d: Dialog, personName?: string): string {
  switch (d.kind) {
    case "request-add":
      return "Request a missing entry";
    case "request-edit":
      return "Request a time change";
    case "request-delete":
      return "Request removal of this entry";
    case "other-add":
      return `Add an entry for ${personName ?? "this person"}`;
    case "other-edit":
      return `Change ${personName ?? "this person"}'s entry`;
    case "other-delete":
      return `Delete ${personName ?? "this person"}'s entry`;
  }
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
