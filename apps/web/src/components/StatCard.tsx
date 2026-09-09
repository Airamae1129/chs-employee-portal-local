import { LucideIcon } from "lucide-react";

export function StatCard({
  icon: Icon,
  value,
  label,
  subtext,
}: {
  icon: LucideIcon;
  value: string | number;
  label: string;
  subtext?: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-card">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-chs-badge">
        <Icon size={18} className="text-chs-gold" />
      </div>
      <div className="text-3xl font-bold text-chs-charcoal">{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
      {subtext ? <div className="mt-1 text-xs text-gray-400">{subtext}</div> : null}
    </div>
  );
}
