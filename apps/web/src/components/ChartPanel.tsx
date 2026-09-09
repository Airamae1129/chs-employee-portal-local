export function BarChartPanel({
  title,
  data,
}: {
  title: string;
  data: { label: string; value: number }[];
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="rounded-2xl bg-white p-6 shadow-card">
      <div className="mb-6 text-base font-bold text-chs-charcoal">{title}</div>
      <div className="flex h-52 items-end gap-3 border-b border-gray-100 pb-2">
        {data.map((d) => (
          <div key={d.label} className="flex flex-1 flex-col items-center justify-end">
            <div
              className="w-full max-w-[36px] rounded-t bg-chs-gold transition-all"
              style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? 6 : 0 }}
              title={`${d.label}: ${d.value}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-3 text-[11px] text-gray-400">
        {data.map((d) => (
          <div key={d.label} className="flex-1 truncate text-center">
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function BreakdownPanel({
  title,
  rows,
  footnote,
}: {
  title: string;
  rows: { label: string; value: number; max?: number }[];
  footnote?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.max ?? r.value), ...rows.map((r) => r.value));
  return (
    <div className="rounded-2xl bg-white p-6 shadow-card">
      <div className="mb-5 text-base font-bold text-chs-charcoal">{title}</div>
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <div className="w-24 shrink-0 text-sm text-gray-600">{r.label}</div>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-chs-gold"
                style={{ width: `${Math.max(4, (r.value / max) * 100)}%` }}
              />
            </div>
            <div className="w-6 text-right text-sm font-semibold text-chs-charcoal">{r.value}</div>
          </div>
        ))}
      </div>
      {footnote ? <div className="mt-5 text-xs text-gray-400">{footnote}</div> : null}
    </div>
  );
}
