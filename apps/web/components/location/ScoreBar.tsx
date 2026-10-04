"use client";

type Props = {
  label: string;
  value: number | null;
  tone?: "default" | "risk" | "good";
};

export function ScoreBar({ label, value, tone = "default" }: Props) {
  const color = tone === "risk" ? "bg-rosewood" : tone === "good" ? "bg-moss" : "bg-aqua";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs font-semibold text-steel">
        <span>{label}</span>
        <span>{value === null ? "Unavailable" : `${Math.round(value)}/100`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink/10">
        <div className={`h-full ${color}`} style={{ width: `${value === null ? 0 : Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}
