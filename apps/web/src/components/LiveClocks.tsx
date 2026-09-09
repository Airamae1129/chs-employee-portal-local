"use client";

import { useEffect, useState } from "react";
import { formatClock, IE_TIME_ZONE, PH_TIME_ZONE } from "@/lib/time";

/** Real-time Ireland / Philippines clock pair, ticking every second. */
export function LiveClocks() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-wrap justify-end gap-3">
      <ClockCard label="Ireland" flag="🇮🇪" zone={IE_TIME_ZONE} now={now} />
      <ClockCard label="Philippines" flag="🇵🇭" zone={PH_TIME_ZONE} now={now} />
    </div>
  );
}

function ClockCard({ label, flag, zone, now }: { label: string; flag: string; zone: string; now: Date | null }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl bg-white px-3.5 py-2 shadow-card">
      <span className="text-lg leading-none">{flag}</span>
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
        <div className="font-mono text-sm font-bold leading-tight tabular-nums text-chs-charcoal">
          {now ? formatClock(zone, now) : "--:--:--"}
        </div>
      </div>
    </div>
  );
}
