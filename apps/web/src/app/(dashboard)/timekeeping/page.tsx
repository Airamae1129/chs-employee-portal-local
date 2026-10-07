"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash2, Plus, LogIn, LogOut, Save, BellRing, ExternalLink } from "lucide-react";
import { PageHeader, Card, Badge } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { LiveClocks } from "@/components/LiveClocks";
import { TimeEntriesPanel } from "@/components/TimeEntriesPanel";
import { CalendarGrid, DayCellData } from "@/components/CalendarGrid";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { notifySuccess, notifyError, confirmAction } from "@/lib/alerts";
import { Task, TaskStatus, TASK_STATUS_CHOICES, TASK_STATUS_LABEL } from "@/lib/tasks";

interface TimeEvent {
  id: string;
  eventType: "IN" | "OUT";
  timestamp: string;
  status: string;
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
  const [birthdays, setBirthdays] = useState<{ id: string; name: string; month: number; day: number }[]>([]);
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayNotes, setDayNotes] = useState<{ id: string; title: string }[]>([]);
  const [noteTitle, setNoteTitle] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);

  const isAdmin = user?.role === "ADMIN";
  const isManager = user?.role === "MANAGER";


  // --- Personal notifications (everyone) + team missing-clock-out log (Manager/Admin) ---
  const [myNotifications, setMyNotifications] = useState<Notification[]>([]);
  const [teamNotifications, setTeamNotifications] = useState<Notification[]>([]);

  // Everyone's birthdays (all roles see all birthdays) merged into the
  // visible month's cells, alongside the personal calendar data.
  const cellData = useMemo(() => {
    const year = monthDate.getUTCFullYear();
    const month = monthDate.getUTCMonth() + 1;
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const merged: Record<string, DayCellData> = { ...calendarData };
    for (const b of birthdays) {
      // Feb 29 birthdays are shown on Feb 28 in non-leap years.
      const day = b.month === 2 && b.day === 29 && !isLeap ? 28 : b.day;
      if (b.month !== month) continue;
      const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      merged[key] = { ...merged[key], birthdays: [...(merged[key]?.birthdays ?? []), { id: b.id, name: b.name }] };
    }
    for (const t of myTasks) {
      const key = t.dueDate.slice(0, 10);
      merged[key] = { ...merged[key], tasks: [...(merged[key]?.tasks ?? []), { id: t.id, subject: t.subject, status: t.status }] };
    }
    return merged;
  }, [calendarData, birthdays, myTasks, monthDate]);

  function monthKey(d: Date) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function refreshMyTasks() {
    apiFetch<{ tasks: Task[] }>(`/tasks/me?month=${monthKey(monthDate)}`)
      .then(({ tasks }) => setMyTasks(tasks))
      .catch(() => void 0);
  }

  async function changeTaskStatus(id: string, status: TaskStatus) {
    try {
      await apiFetch(`/tasks/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      refreshMyTasks();
      notifySuccess("Task updated", TASK_STATUS_LABEL[status]);
    } catch (e) {
      notifyError("Couldn't update task", e instanceof Error ? e.message : undefined);
    }
  }

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
      // Every leave request appears on the calendar: approved as "Leave", still-pending as "Leave (pending)".
      for (const l of leave) {
        let d = new Date(`${l.startDate.slice(0, 10)}T00:00:00Z`);
        const end = new Date(`${l.endDate.slice(0, 10)}T00:00:00Z`);
        while (d <= end) {
          const day = d.toISOString().slice(0, 10);
          data[day] = l.status === "APPROVED" ? { ...data[day], onLeave: true } : { ...data[day], leavePending: true };
          d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
        }
      }
      for (const e of entries) {
        const day = e.date.slice(0, 10);
        data[day] = { ...data[day], notes: [...(data[day]?.notes ?? []), { id: e.id, title: e.title }] };
      }

      setCalendarData(data);
    });
  }


  useEffect(() => {
    refreshRecentEvents();
    apiFetch<{ notifications: Notification[] }>("/notifications/me").then(({ notifications }) => setMyNotifications(notifications));
    apiFetch<{ birthdays: typeof birthdays }>("/calendar/birthdays")
      .then(({ birthdays }) => setBirthdays(birthdays))
      .catch(() => void 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshMyTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthDate]);

  useEffect(() => {
    refreshCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthDate]);

  useEffect(() => {
    if (!user) return;
    if (isManager || isAdmin) {
      apiFetch<{ notifications: Notification[] }>("/notifications/team-log").then(({ notifications }) => setTeamNotifications(notifications));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, isManager, user]);


  async function handleClock(type: "IN" | "OUT") {
    const ok = await confirmAction({
      title: type === "IN" ? "Clock in now?" : "Clock out now?",
      confirmText: type === "IN" ? "Clock In" : "Clock Out",
    });
    if (!ok) return;
    setClocking(true);
    try {
      await apiFetch("/time/clock", { method: "POST", body: JSON.stringify({ eventType: type }) });
      // Show the confirmation, then reload the whole page once it closes so
      // every panel (status, calendar, entries, notifications) is fresh.
      await notifySuccess(type === "IN" ? "Clocked in" : "Clocked out", new Date().toLocaleTimeString());
      window.location.reload();
      return;
    } catch (e) {
      notifyError("Something went wrong", e instanceof Error ? e.message : undefined);
    }
    setClocking(false);
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
            cellData={cellData}
            onDayClick={openDay}
            onPrevMonth={() => setMonthDate(new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() - 1, 1)))}
            onNextMonth={() => setMonthDate(new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1)))}
          />
          <p className="mt-2 text-xs text-gray-400">
            Green = hours logged · Red = Ireland holiday · Purple = Philippines holiday · Blue = leave (dashed = pending) · Pink = birthday · Indigo/Amber/Cyan =
            assigned task (assigned / in progress / for review) · Gray = your task note. Click a date to add, edit or remove a note.
          </p>
        </div>
      </div>

      <TimeEntriesPanel
        user={user}
        monthDate={monthDate}
        onChanged={() => {
          refreshRecentEvents();
          refreshCalendar();
        }}
      />

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

            {(cellData[selectedDate]?.birthdays?.length ?? 0) > 0 && (
              <div className="mt-3 space-y-2">
                {cellData[selectedDate]!.birthdays!.map((b) => (
                  <div key={b.id} className="rounded-lg bg-pink-50 px-3 py-2 text-sm text-pink-700">
                    🎂 It&apos;s {b.name}&apos;s birthday!
                  </div>
                ))}
              </div>
            )}

            {myTasks
              .filter((t) => t.dueDate.slice(0, 10) === selectedDate)
              .map((t) => (
                <div key={t.id} className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
                  <div className="text-sm font-semibold text-chs-charcoal">📌 {t.subject}</div>
                  <div className="text-xs text-gray-400">Assigned by {t.assignedByName}</div>
                  {t.note && <div className="mt-1.5 whitespace-pre-line text-sm text-gray-600">{t.note}</div>}
                  {t.link && (
                    <a href={t.link} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-chs-charcoal hover:underline">
                      <ExternalLink size={12} /> Open link
                    </a>
                  )}
                  <div className="mt-2.5">
                    <label className="mb-1 block text-xs font-medium text-gray-500">Status</label>
                    <select
                      value={t.status}
                      onChange={(e) => changeTaskStatus(t.id, e.target.value as TaskStatus)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-chs-charcoal"
                    >
                      {t.status === "ASSIGNED" && (
                        <option value="ASSIGNED" disabled>
                          Assigned — choose a status
                        </option>
                      )}
                      {TASK_STATUS_CHOICES.map((s) => (
                        <option key={s} value={s}>
                          {TASK_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}

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


    </div>
  );
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
