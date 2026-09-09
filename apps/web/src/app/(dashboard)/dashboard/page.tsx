"use client";

import { useEffect, useState } from "react";
import { Clock, FileText, CalendarDays, BookOpen, Users, ShieldCheck, Link2, CalendarOff } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { BarChartPanel, BreakdownPanel } from "@/components/ChartPanel";
import { LiveClocks } from "@/components/LiveClocks";
import { AnnouncementsPanel } from "@/components/AnnouncementsPanel";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/lib/useCurrentUser";

function last14Days(): string[] {
  const days: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export default function DashboardPage() {
  const { user } = useCurrentUser();
  const [hoursThisWeek, setHoursThisWeek] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [upcomingHolidays, setUpcomingHolidays] = useState(0);
  const [policyCount, setPolicyCount] = useState(0);
  const [leaveRemaining, setLeaveRemaining] = useState<number | null>(null);
  const [clockChart, setClockChart] = useState<{ label: string; value: number }[]>([]);
  const [requestsByType, setRequestsByType] = useState<{ label: string; value: number }[]>([]);

  const [teamOpenSessions, setTeamOpenSessions] = useState<number | null>(null);
  const [teamPendingApprovals, setTeamPendingApprovals] = useState<number | null>(null);

  const [staffCount, setStaffCount] = useState<number | null>(null);
  const [pendingWorkspaceRequests, setPendingWorkspaceRequests] = useState<number | null>(null);
  const [auditToday, setAuditToday] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;

    apiFetch<{ events: any[] }>("/time/me?range=" + [daysAgoIso(14), new Date().toISOString()].join(","))
      .then(({ events }) => {
        const days = last14Days();
        const counts = Object.fromEntries(days.map((d) => [d, 0]));
        for (const e of events) {
          const day = e.timestamp.slice(0, 10);
          if (day in counts) counts[day] += 1;
        }
        setClockChart(days.map((d) => ({ label: d.slice(5), value: counts[d] })));

        const weekAgo = daysAgoIso(7);
        const thisWeek = events.filter((e) => e.timestamp >= weekAgo);
        setHoursThisWeek(computeHours(thisWeek));
      })
      .catch(() => void 0);

    apiFetch<{ requests: any[] }>("/hr-requests/me")
      .then(({ requests }) => {
        setPendingRequests(requests.filter((r) => r.status === "SUBMITTED").length);
        const byType: Record<string, number> = { LEAVE: 0, COE: 0, HR_LETTER: 0, OTHER: 0 };
        for (const r of requests) byType[r.requestType] = (byType[r.requestType] ?? 0) + 1;
        setRequestsByType([
          { label: "Leave", value: byType.LEAVE },
          { label: "COE", value: byType.COE },
          { label: "HR Letter", value: byType.HR_LETTER },
          { label: "Other", value: byType.OTHER },
        ]);
      })
      .catch(() => void 0);

    apiFetch<{ holidays: any[] }>(`/holidays?country=${user.country}&year=${new Date().getFullYear()}`)
      .then(({ holidays }) => {
        const todayIso = new Date().toISOString().slice(0, 10);
        setUpcomingHolidays(holidays.filter((h) => h.date.slice(0, 10) >= todayIso).length);
      })
      .catch(() => void 0);

    apiFetch<{ policies: any[] }>("/policies")
      .then(({ policies }) => setPolicyCount(policies.length))
      .catch(() => void 0);

    apiFetch<{ balance: { remaining: number; total: number } }>("/hr-requests/leave-balance")
      .then(({ balance }) => setLeaveRemaining(balance.remaining))
      .catch(() => void 0);

    if (user.role === "MANAGER" || user.role === "ADMIN") {
      apiFetch<{ events: any[]; exceptions: { missingClockOuts: any[] } }>(
        "/time/team?range=" + [daysAgoIso(1), new Date().toISOString()].join(",")
      )
        .then(({ exceptions }) => setTeamOpenSessions(exceptions.missingClockOuts.length))
        .catch(() => void 0);

      apiFetch<{ requests: any[] }>("/hr-requests/team")
        .then(({ requests }) => setTeamPendingApprovals(requests.filter((r) => r.status === "SUBMITTED").length))
        .catch(() => void 0);
    }

    if (user.role === "ADMIN") {
      apiFetch<{ users: any[] }>("/users").then(({ users }) => setStaffCount(users.length)).catch(() => void 0);
      apiFetch<{ requests: any[] }>("/workspaces/requests/pending")
        .then(({ requests }) => setPendingWorkspaceRequests(requests.length))
        .catch(() => void 0);
      apiFetch<{ entries: any[] }>("/audit-log")
        .then(({ entries }) => {
          const todayIso = new Date().toISOString().slice(0, 10);
          setAuditToday(entries.filter((e) => e.timestamp.slice(0, 10) === todayIso).length);
        })
        .catch(() => void 0);
    }
  }, [user]);

  if (!user) return null;

  return (
    <div>
      <PageHeader title="Dashboard" action={<LiveClocks />} />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        <StatCard icon={Clock} value={hoursThisWeek.toFixed(1)} label="Hours this week" />
        <StatCard icon={FileText} value={pendingRequests} label="Pending HR requests" />
        <StatCard icon={CalendarDays} value={upcomingHolidays} label="Upcoming holidays" subtext={user.country === "IRELAND" ? "Ireland" : "Philippines"} />
        <StatCard icon={BookOpen} value={policyCount} label="Policies published" />
        <StatCard icon={CalendarOff} value={leaveRemaining ?? "—"} label="Paid leave days left" subtext="of 12 this year" />

        {(user.role === "MANAGER" || user.role === "ADMIN") && (
          <>
            <StatCard icon={Users} value={teamOpenSessions ?? "—"} label="Missing clock-outs (team)" />
            <StatCard icon={FileText} value={teamPendingApprovals ?? "—"} label="Approvals awaiting you" />
          </>
        )}

        {user.role === "ADMIN" && (
          <>
            <StatCard icon={Link2} value={pendingWorkspaceRequests ?? "—"} label="Workspace access requests" />
            <StatCard icon={ShieldCheck} value={auditToday ?? "—"} label="Audit events today" />
            <StatCard icon={Users} value={staffCount ?? "—"} label="Staff accounts" />
          </>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BarChartPanel title="Your clock events — last 14 days" data={clockChart} />
        <BreakdownPanel
          title="Your HR requests by type"
          rows={requestsByType}
          footnote="Includes submitted, approved and rejected requests."
        />
      </div>

      <div className="mt-6">
        <AnnouncementsPanel user={user} />
      </div>
    </div>
  );
}

function daysAgoIso(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
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
