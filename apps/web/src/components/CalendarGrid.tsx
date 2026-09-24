"use client";

export interface DayCellData {
  hours?: number;
  holidays?: { name: string; type: string; country: "IRELAND" | "PHILIPPINES" }[];
  onLeave?: boolean;
  notes?: { id: string; title: string }[];
  birthdays?: { id: string; name: string }[];
  tasks?: { id: string; subject: string; status: "ASSIGNED" | "IN_PROGRESS" | "FOR_REVIEW" | "DONE" }[];
}

const TASK_CHIP: Record<string, string> = {
  ASSIGNED: "bg-indigo-50 text-indigo-600",
  IN_PROGRESS: "bg-amber-50 text-amber-700",
  FOR_REVIEW: "bg-cyan-50 text-cyan-700",
  DONE: "bg-gray-100 text-gray-400 line-through",
};

// Ireland and Philippines holidays get distinct colors so a day paid
// under either country's calendar (Payroll: Ireland holidays are
// company-wide) is visually distinguishable at a glance.
const HOLIDAY_COLOR: Record<"IRELAND" | "PHILIPPINES", string> = {
  IRELAND: "bg-red-50 text-red-600",
  PHILIPPINES: "bg-purple-50 text-purple-600",
};

export function CalendarGrid({
  monthDate,
  cellData,
  onDayClick,
  onPrevMonth,
  onNextMonth,
}: {
  monthDate: Date;
  cellData: Record<string, DayCellData>;
  onDayClick?: (dateStr: string) => void;
  onPrevMonth?: () => void;
  onNextMonth?: () => void;
}) {
  const year = monthDate.getUTCFullYear();
  const month = monthDate.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const startOffset = firstDay.getUTCDay(); // 0=Sun
  const totalDays = lastDay.getUTCDate();

  const cells: (string | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: totalDays }, (_, i) =>
      `${year}-${String(month + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`
    ),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = monthDate.toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" });
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="rounded-2xl bg-white p-6 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={onPrevMonth} className="rounded-lg px-3 py-1 text-sm text-gray-500 hover:bg-gray-100">
          ← Prev
        </button>
        <div className="text-base font-bold text-chs-charcoal">{monthLabel}</div>
        <button onClick={onNextMonth} className="rounded-lg px-3 py-1 text-sm text-gray-500 hover:bg-gray-100">
          Next →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-gray-400">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((dateStr, i) => {
          if (!dateStr) return <div key={i} className="min-h-[86px]" />;
          const data = cellData[dateStr];
          const isToday = dateStr === todayIso;
          const dayNum = parseInt(dateStr.slice(8, 10), 10);
          return (
            <button
              key={dateStr}
              onClick={() => onDayClick?.(dateStr)}
              className={`min-h-[86px] rounded-lg border p-1.5 text-left align-top text-xs transition-colors hover:border-chs-gold ${
                isToday ? "border-chs-gold bg-chs-badge/40" : "border-gray-100"
              }`}
            >
              <div className={`mb-1 font-semibold ${isToday ? "text-chs-gold" : "text-gray-500"}`}>{dayNum}</div>
              <div className="space-y-0.5">
                {data?.holidays?.map((h, i) => (
                  <div key={i} className={`truncate rounded px-1 py-0.5 text-[10px] ${HOLIDAY_COLOR[h.country]}`}>
                    {h.name}
                  </div>
                ))}
                {data?.birthdays?.map((b) => (
                  <div key={b.id} className="truncate rounded bg-pink-50 px-1 py-0.5 text-[10px] text-pink-600">
                    🎂 {b.name}
                  </div>
                ))}
                {data?.tasks?.map((t) => (
                  <div key={t.id} className={`truncate rounded px-1 py-0.5 text-[10px] ${TASK_CHIP[t.status]}`}>
                    📌 {t.subject}
                  </div>
                ))}
                {data?.onLeave ? (
                  <div className="truncate rounded bg-blue-50 px-1 py-0.5 text-[10px] text-blue-600">Leave</div>
                ) : null}
                {typeof data?.hours === "number" && data.hours > 0 ? (
                  <div className="truncate rounded bg-green-50 px-1 py-0.5 text-[10px] text-green-700">
                    {data.hours.toFixed(1)}h
                  </div>
                ) : null}
                {data?.notes?.map((n) => (
                  <div key={n.id} className="truncate rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-600">
                    {n.title}
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
