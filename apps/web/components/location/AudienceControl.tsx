import type { Audience } from "@/lib/types/domain";

export function AudienceControl({ audience, onChange, disabled }: { audience: Audience; onChange: (audience: Audience) => void; disabled?: boolean }) {
  return <div className="audience-control" role="group" aria-label="Explanation audience">{(["developer", "government", "community"] as const).map((mode) =>
    <button className={audience === mode ? "bg-aqua text-contrast" : "text-steel"} aria-pressed={audience === mode} disabled={disabled} onClick={() => onChange(mode)} key={mode}>{mode}</button>)}</div>;
}
