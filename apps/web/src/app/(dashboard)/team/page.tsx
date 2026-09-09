"use client";

import { useEffect, useState } from "react";
import { Users, AlertTriangle, Clock } from "lucide-react";
import { PageHeader, Card, Badge } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";

interface TeamEvent {
  id: string;
  userId: string;
  eventType: "IN" | "OUT";
  timestamp: string;
  user: { id: string; name: string; email: string; country: string };
}

export default function TeamPage() {
  const { user } = useCurrentUser();
  const [events, setEvents] = useState<TeamEvent[]>([]);
  const [missingClockOuts, setMissingClockOuts] = useState<TeamEvent[]>([]);
  const [calendarEntries, setCalendarEntries] = useState<any[]>([]);
  const [teamUsers, setTeamUsers] = useState<{ id: string; name: string; country: string }[]>([]);

  function refresh() {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    apiFetch<{ events: TeamEvent[]; exceptions: { missingClockOuts: TeamEvent[] } }>(
      `/time/team?range=${from.toISOString()},${new Date().toISOString()}`
    ).then(({ events, exceptions }) => {
      setEvents(events);
      setMissingClockOuts(exceptions.missingClockOuts);
    });

    const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    apiFetch<{ users: any[]; entries: any[] }>(`/calendar/team?month=${month}`).then(({ users, entries }) => {
      setTeamUsers(users);
      setCalendarEntries(entries);
    });
  }

  useEffect(() => {
    if (!user) return;
    refresh();
    // Keep "who's clocked in now" current without a manual reload.
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!user) return null;

  const clockedInNow = new Map<string, boolean>();
  const byUser: Record<string, TeamEvent[]> = {};
  for (const e of [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    (byUser[e.userId] ??= []).push(e);
  }
  for (const [uid, evs] of Object.entries(byUser)) {
    clockedInNow.set(uid, evs[evs.length - 1]?.eventType === "IN");
  }
  const clockedInCount = [...clockedInNow.values()].filter(Boolean).length;

  return (
    <div>
      <PageHeader title={user.role === "ADMIN" ? "All Staff — Timekeeping" : "My Team — Timekeeping"} />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <StatCard icon={Users} value={teamUsers.length || Object.keys(byUser).length} label="Team members" />
        <StatCard icon={Clock} value={clockedInCount} label="Clocked in now" />
        <StatCard icon={AlertTriangle} value={missingClockOuts.length} label="Missing clock-outs" />
      </div>

      <Card className="mt-6">
        <div className="mb-4 text-base font-bold text-chs-charcoal">Today&apos;s clock events</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs uppercase text-gray-400">
                <th className="py-2">Employee</th>
                <th className="py-2">Country</th>
                <th className="py-2">Event</th>
                <th className="py-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(0, 30).map((e) => (
                <tr key={e.id} className="border-b border-gray-50">
                  <td className="py-2.5">{e.user.name}</td>
                  <td className="py-2.5 text-gray-500">{e.user.country}</td>
                  <td className="py-2.5">
                    <Badge tone={e.eventType === "IN" ? "green" : "gray"}>
                      {e.eventType === "IN" ? "Clocked In" : "Clocked Out"}
                    </Badge>
                  </td>
                  <td className="py-2.5 text-gray-500">{new Date(e.timestamp).toLocaleString()}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-sm text-gray-400">
                    No clock events yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-6">
        <div className="mb-4 text-base font-bold text-chs-charcoal">Team task notes this month</div>
        {calendarEntries.filter((e) => e.entryType === "TASK_NOTE").length === 0 ? (
          <div className="text-sm text-gray-400">No task notes logged this month.</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {calendarEntries
              .filter((e) => e.entryType === "TASK_NOTE")
              .map((e) => (
                <div key={e.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-chs-charcoal">{e.title}</span>
                  <span className="text-gray-400">{e.date.slice(0, 10)}</span>
                </div>
              ))}
          </div>
        )}
        <p className="mt-3 text-xs text-gray-400">Read-only — task notes belong to each employee.</p>
      </Card>
    </div>
  );
}
