"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash2, Plus, LogIn, LogOut, Save, BellRing } from "lucide-react";
import { PageHeader, Card, Badge } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { LiveClocks } from "@/components/LiveClocks";
import { CalendarGrid, DayCellData } from "@/components/CalendarGrid";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { notifySuccess, notifyError, confirmAction } from "@/lib/alerts";

interface TimeEvent {
  id: string;
  eventType: "IN" | "OUT";
  timestamp: string;
  status: string;
}
interface TeamMember {
  id: string;
  name: string;
  country: "IRELAND" | "PHILIPPINES";
}
interface Notification {
  id: string;
  message: string;
  createdAt: string;
  user?: { name: string } | null;
}

export default function TimekeepingPage() {
  const { user } = useCurrentUser();
  const [events, setEvents] = useState<TimeEvent[]>([]);
  const [clocking, setClocking] = useState(false);
  const [monthDate, setMonthDate] = useState(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  });
  const [calendarData, setCalendarData] = useState<Record<string, DayCellData>>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayNotes, setDayNotes] = useState<{ id: string; title: string }[]>([]);
  const [noteTitle, setNoteTitle] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);

  const isAdmin = user?.role === "ADMIN";
  const isManager = user?.role === "MANAGER";

  // --- Manage time entries: everyone manages their own; Admin can also pick anyone. ---
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [manageUserId, setManageUserId] = useState<string>("");
  const [manageEvents, setManageEvents] = useState<TimeEvent[]>([]);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [entryType, setEntryType] = useState<"IN" | "OUT">("IN");
  const [entryDateTime, setEntryDateTime] = useState("");
  const [editingEntry, setEditingEntry] = useState<TimeEvent | null>(null);
  const [editDateTime, setEditDateTime] = useState("");

  // --- Personal notifications (everyone) + team missing-clock-out log (Manager/Admin) ---
  const [myNotifications, setMyNotifications] = useState<Notification[]>([]);
  const [teamNotifications, setTeamNotifications] = useState<Notification[]>([]);

  const lastEvent = events[0];
  const isClockedIn = lastEvent?.eventType === "IN";

  function refreshRecentEvents() {
    const from = new Date();
    from.setDate(from.getDate() - 14);
    apiFetch<{ events: TimeEvent[] }>(`/time/me?range=${from.toISOString()},${new Date().toISOString()}`)
      .then(({ events }) => setEvents(events))
      .catch(() => void 0);
  }

  function refreshCalendar() {
    const month = `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}`;
    apiFetch<{ timeEvents: any[]; leave: any[]; holidays: any[]; entries: any[] }>(
      `/calendar/me?month=${month}`
    ).then(({ timeEvents, leave, holidays, entries }) => {
      const data: Record<string, DayCellData> = {};

      const byDay: Record<string, { eventType: string; timestamp: string }[]> = {};
      for (const e of timeEvents) {
        const day = e.timestamp.slice(0, 10);
        (byDay[day] ??= []).push(e);
      }
      for (const [day, dayEvents] of Object.entries(byDay)) {
        data[day] = { ...data[day], hours: computeHours(dayEvents) };
      }

      for (const h of holidays) {
        const day = h.date.slice(0, 10);
        data[day] = { ...data[day], holidays: [...(data[day]?.holidays ?? []), { name: h.name, type: h.type, country: h.country }] };
      }
      for (const l of leave) {
        let d = new Date(l.startDate);
        const end = new Date(l.endDate);
        while (d <= end) {
          const day = d.toISOString().slice(0, 10);
          data[day] = { ...data[day], onLeave: true };
          d.setDate(d.getDate() + 1);
        }
      }
      for (const e of entries) {
        const day = e.date.slice(0, 10);
        data[day] = { ...data[day], notes: [...(data[day]?.notes ?? []), { id: e.id, title: e.title }] };
      }

      setCalendarData(data);
    });
  }

  // Manage-entries range follows the calendar's selected month (not a
  // fixed "last 14 days") — otherwise adding/editing an entry for a
  // past period (e.g. last month, for a payroll re-check) succeeds but
  // then never shows up to edit, since it falls outside a fixed window.
  // Only Admin can call /time/team (Manager/Employee are self-only now),
  // so everyone else just reads their own log via /time/me.
  function refreshManageEvents(userId: string, month: Date = monthDate) {
    if (!userId) return;
    const from = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
    const to = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0, 23, 59, 59));
    if (isAdmin) {
      apiFetch<{ events: (TimeEvent & { userId: string })[] }>(`/time/team?range=${from.toISOString()},${to.toISOString()}`)
        .then(({ events }) => setManageEvents(events.filter((e) => e.userId === userId)))
        .catch(() => void 0);
    } else {
      apiFetch<{ events: TimeEvent[] }>(`/time/me?range=${from.toISOString()},${to.toISOString()}`)
        .then(({ events }) => setManageEvents(events))
        .catch(() => void 0);
    }
  }

  useEffect(() => {
    refreshRecentEvents();
    apiFetch<{ notifications: Notification[] }>("/notifications/me").then(({ notifications }) => setMyNotifications(notifications));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshCalendar();
    if (manageUserId) refreshManageEvents(manageUserId, monthDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthDate]);

  useEffect(() => {
    if (!user) return;
    if (isAdmin) {
      apiFetch<{ users: TeamMember[] }>(`/calendar/team?month=${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}`)
        .then(({ users }) => {
          setTeamMembers(users);
          setManageUserId((prev) => prev || user.id);
        })
        .catch(() => void 0);
    } else {
      setManageUserId(user.id);
    }
    if (isManager || isAdmin) {
      apiFetch<{ notifications: Notification[] }>("/notifications/team-log").then(({ notifications }) => setTeamNotifications(notifications));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, isManager, user]);

  useEffect(() => {
    if (manageUserId) refreshManageEvents(manageUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manageUserId]);

  async function handleClock(type: "IN" | "OUT") {
    const ok = await confirmAction({
      title: type === "IN" ? "Clock in now?" : "Clock out now?",
      confirmText: type === "IN" ? "Clock In" : "Clock Out",
    });
    if (!ok) return;
    setClocking(true);
    try {
      await apiFetch("/time/clock", { method: "POST", body: JSON.stringify({ eventType: type }) });
      refreshRecentEvents();
      refreshCalendar();
      if (manageUserId === user?.id) refreshManageEvents(manageUserId);
      notifySuccess(type === "IN" ? "Clocked in" : "Clocked out", new Date().toLocaleTimeString());
    } catch (e) {
      notifyError("Something went wrong", e instanceof Error ? e.message : undefined);
    } finally {
      setClocking(false);
    }
  }

  function openDay(dateStr: string) {
    setSelectedDate(dateStr);
    setDayNotes(calendarData[dateStr]?.notes ?? []);
    setNoteTitle("");
    setEditingNoteId(null);
  }

  async function saveNote() {
    if (!selectedDate || !noteTitle.trim()) return;
    setSavingNote(true);
    try {
      if (editingNoteId) {
        await apiFetch(`/calendar/notes/${editingNoteId}`, {
          method: "PATCH",
          body: JSON.stringify({ title: noteTitle.trim() }),
        });
      } else {
        await apiFetch("/calendar/notes", {
          method: "POST",
          body: JSON.stringify({ date: selectedDate, title: noteTitle.trim() }),
        });
      }
      setNoteTitle("");
      setEditingNoteId(null);
      setSelectedDate(null);
      refreshCalendar();
      notifySuccess("Saved");
    } catch (e) {
      notifyError("Couldn't save note", e instanceof Error ? e.message : undefined);
    } finally {
      setSavingNote(false);
    }
  }

  async function deleteNote(id: string) {
    const ok = await confirmAction({ title: "Delete this note?", danger: true, confirmText: "Delete" });
    if (!ok) return;
    await apiFetch(`/calendar/notes/${id}`, { method: "DELETE" });
    setDayNotes((prev) => prev.filter((n) => n.id !== id));
    refreshCalendar();
  }

  async function addManualEntry() {
    if (!manageUserId || !entryDateTime) return;
    try {
      await apiFetch("/time/entry", {
        method: "POST",
        body: JSON.stringify({
          userId: manageUserId,
          eventType: entryType,
          timestamp: new Date(entryDateTime).toISOString(),
        }),
      });
      setShowAddEntry(false);
      setEntryDateTime("");
      refreshManageEvents(manageUserId);
      notifySuccess("Time entry added");
    } catch (e) {
      notifyError("Couldn't add entry", e instanceof Error ? e.message : undefined);
    }
  }

  async function saveEditEntry() {
    if (!editingEntry || !editDateTime) return;
    try {
      await apiFetch("/time/correction", {
        method: "POST",
        body: JSON.stringify({
          timeEventId: editingEntry.id,
          correctedTimestamp: new Date(editDateTime).toISOString(),
          notes: "Corrected via Timekeeping",
        }),
      });
      setEditingEntry(null);
      refreshManageEvents(manageUserId);
      notifySuccess("Time entry updated");
    } catch (e) {
      notifyError("Couldn't update entry", e instanceof Error ? e.message : undefined);
    }
  }

  async function deleteEntry(id: string) {
    const ok = await confirmAction({ title: "Delete this time entry?", danger: true, confirmText: "Delete" });
    if (!ok) return;
    await apiFetch(`/time/${id}`, { method: "DELETE" });
    refreshManageEvents(manageUserId);
    notifySuccess("Time entry deleted");
  }

  const todayHours = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const todays = events.filter((e) => e.timestamp.slice(0, 10) === todayIso);
    return computeHours(todays);
  }, [events]);

  if (!user) return null;

  return (
    <div>
      <PageHeader title="Timekeeping & Calendar" action={<LiveClocks />} />

      {myNotifications.length > 0 && (
        <Card className="mb-6 border border-chs-gold/40 bg-chs-badge/30">
          <div className="mb-2 flex items-center gap-2 text-sm font-bold text-chs-charcoal">
            <BellRing size={16} className="text-chs-gold" />
            Notifications
          </div>
          <div className="space-y-1.5">
            {myNotifications.slice(0, 5).map((n) => (
              <div key={n.id} className="text-sm text-chs-charcoal">
                {n.message}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="text-sm text-gray-500">Current status</div>
          <div className={`mt-1 text-xl font-bold ${isClockedIn ? "text-green-600" : "text-gray-400"}`}>
            {isClockedIn ? "Clocked in" : "Clocked out"}
          </div>
          <div className="mt-1 text-sm text-gray-500">Today so far: {todayHours.toFixed(2)}h</div>

          <button
            onClick={() => handleClock(isClockedIn ? "OUT" : "IN")}
            disabled={clocking}
            className={`mt-5 flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:opacity-60 ${
              isClockedIn ? "bg-red-500 hover:opacity-90" : "bg-chs-gold text-chs-charcoal hover:opacity-90"
            }`}
          >
            {isClockedIn ? <LogOut size={16} /> : <LogIn size={16} />}
            {clocking ? "Please wait..." : isClockedIn ? "Clock Out" : "Clock In"}
          </button>

          <div className="mt-6 text-sm font-semibold text-chs-charcoal">Recent activity</div>
          <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
            {events.slice(0, 10).map((e) => (
              <div key={e.id} className="flex items-center justify-between text-xs text-gray-500">
                <span>{e.eventType === "IN" ? "Clocked In" : "Clocked Out"}</span>
                <span>{new Date(e.timestamp).toLocaleString()}</span>
              </div>
            ))}
            {events.length === 0 && <div className="text-xs text-gray-400">No activity yet.</div>}
          </div>
        </Card>

        <div className="lg:col-span-2">
          <CalendarGrid
            monthDate={monthDate}
            cellData={calendarData}
            onDayClick={openDay}
            onPrevMonth={() => setMonthDate(new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() - 1, 1)))}
            onNextMonth={() => setMonthDate(new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1)))}
          />
          <p className="mt-2 text-xs text-gray-400">
            Green = hours logged · Red = Ireland holiday · Purple = Philippines holiday · Blue = approved leave · Gray
            = your task note. Click a date to add, edit or remove a note.
          </p>
        </div>
      </div>

      <Card className="mt-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-base font-bold text-chs-charcoal">
              {isAdmin ? "Manage time entries" : "Manage your time entries"}
            </div>
            <div className="text-xs text-gray-400">
              {isAdmin ? "Add, edit, or delete clock in/out records for any employee" : "Add, edit, or delete your own clock in/out records"} —
              showing {monthDate.toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" })}. Use ← Prev / Next → above to
              change the month.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <select
                value={manageUserId}
                onChange={(e) => setManageUserId(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
              >
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
            <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowAddEntry(true)}>
              Add entry
            </Button>
          </div>
        </div>

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
              {manageEvents.map((e) => (
                <tr key={e.id} className="border-b border-gray-50">
                  <td className="py-2.5">{e.eventType === "IN" ? "Clock In" : "Clock Out"}</td>
                  <td className="py-2.5 text-gray-500">{new Date(e.timestamp).toLocaleString()}</td>
                  <td className="py-2.5 text-gray-500">{e.status}</td>
                  <td className="py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Pencil size={12} />}
                        onClick={() => {
                          setEditingEntry(e);
                          setEditDateTime(toLocalInputValue(e.timestamp));
                        }}
                      >
                        Edit
                      </Button>
                      <Button size="sm" variant="destructive" icon={<Trash2 size={12} />} onClick={() => deleteEntry(e.id)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {manageEvents.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-sm text-gray-400">
                    No time entries this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {(isManager || isAdmin) && (
        <Card className="mt-6">
          <div className="mb-1 flex items-center gap-2 text-base font-bold text-chs-charcoal">
            <BellRing size={16} className="text-chs-gold" />
            Missing clock-out notifications {isManager ? "— your team" : "— everyone"}
          </div>
          <p className="mb-4 text-xs text-gray-400">
            Sent automatically every Saturday 12:00 AM Ireland time to anyone with an open (missing clock-out)
            session — no manual editing needed.
          </p>
          <div className="space-y-2">
            {teamNotifications.slice(0, 10).map((n) => (
              <div key={n.id} className="flex items-center justify-between rounded-lg bg-chs-bg px-3 py-2 text-sm">
                <div>
                  <span className="font-medium text-chs-charcoal">{n.user?.name ?? "Unknown"}</span>{" "}
                  <span className="text-gray-500">{n.message}</span>
                </div>
                <Badge tone="gold">{new Date(n.createdAt).toLocaleDateString()}</Badge>
              </div>
            ))}
            {teamNotifications.length === 0 && <div className="text-sm text-gray-400">No missing clock-out notifications sent yet.</div>}
          </div>
        </Card>
      )}

      {selectedDate && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <Card className="w-full max-w-sm">
            <div className="text-base font-bold text-chs-charcoal">Notes — {selectedDate}</div>

            {dayNotes.length > 0 && (
              <div className="mt-3 space-y-2">
                {dayNotes.map((n) => (
                  <div key={n.id} className="flex items-center justify-between rounded-lg bg-chs-bg px-3 py-2 text-sm">
                    <span className="text-chs-charcoal">{n.title}</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingNoteId(n.id);
                          setNoteTitle(n.title);
                        }}
                        className="text-gray-400 hover:text-chs-gold"
                        aria-label="Edit note"
                      >
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => deleteNote(n.id)} className="text-gray-400 hover:text-red-500" aria-label="Delete note">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <input
              autoFocus
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              placeholder="e.g. Onsite client visit"
              className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal outline-none focus:border-chs-gold"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setSelectedDate(null);
                  setNoteTitle("");
                  setEditingNoteId(null);
                }}
              >
                Close
              </Button>
              <Button icon={editingNoteId ? <Save size={14} /> : <Plus size={14} />} onClick={saveNote} disabled={savingNote || !noteTitle.trim()}>
                {editingNoteId ? "Save changes" : "Add note"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {showAddEntry && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <Card className="w-full max-w-sm">
            <div className="text-base font-bold text-chs-charcoal">Add time entry</div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Type</label>
                <select
                  value={entryType}
                  onChange={(e) => setEntryType(e.target.value as "IN" | "OUT")}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
                >
                  <option value="IN">Clock In</option>
                  <option value="OUT">Clock Out</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-chs-charcoal">Date & time</label>
                <input
                  type="datetime-local"
                  value={entryDateTime}
                  onChange={(e) => setEntryDateTime(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowAddEntry(false)}>
                Cancel
              </Button>
              <Button icon={<Plus size={14} />} onClick={addManualEntry} disabled={!entryDateTime}>
                Add entry
              </Button>
            </div>
          </Card>
        </div>
      )}

      {editingEntry && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <Card className="w-full max-w-sm">
            <div className="text-base font-bold text-chs-charcoal">
              Edit {editingEntry.eventType === "IN" ? "Clock In" : "Clock Out"}
            </div>
            <input
              type="datetime-local"
              value={editDateTime}
              onChange={(e) => setEditDateTime(e.target.value)}
              className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditingEntry(null)}>
                Cancel
              </Button>
              <Button icon={<Save size={14} />} onClick={saveEditEntry}>Save changes</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function computeHours(events: { eventType: string; timestamp: string }[]): number {
  let total = 0;
  let lastIn: string | null = null;
  for (const e of [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    if (e.eventType === "IN") lastIn = e.timestamp;
    else if (e.eventType === "OUT" && lastIn) {
      total += (new Date(e.timestamp).getTime() - new Date(lastIn).getTime()) / 3_600_000;
      lastIn = null;
    }
  }
  return total;
}
