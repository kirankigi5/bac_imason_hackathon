"use client";

import { ArrowDown, ArrowRight, RefreshCw } from "lucide-react";
import type { RankingDiff } from "@/lib/frontend/contracts";
import { factorLabels as categoryLabels } from "@/lib/frontend/factor-metadata";
import { displayValue } from "@/components/location/MetricDetails";
import { FeasibilityStatus } from "@/components/location/FeasibilityStatus";

export const signed = (value: number) => (value > 0 ? "+" : "") + String(value);
const rank = (value: number | null) => value === null ? "Excluded" : "#" + value;
function fieldValue(field: string, value: unknown) {
  return field.startsWith("weights.") && typeof value === "number" ? `${(value * 100).toFixed(2)}%` : displayValue(value);
}
export function RankingDiffPanel({ diff, loading, error, onRetry, countyName }: { diff?: RankingDiff; loading: boolean; error?: string; onRetry: () => void; countyName: (id: string) => string }) {
  return <div data-testid="ranking-diff">
    <div className="panel-heading"><h3>What Changed?</h3><button className="icon-button" title="Refresh ranking diff" aria-label="Refresh ranking diff" onClick={onRetry}><RefreshCw size={16} /></button></div>
    {loading ? <p role="status">Loading exact ranking changes...</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {!loading && !error && !diff ? <p className="empty-state">No before/after ranking change yet.</p> : null}
    {diff ? <>
      <div className="change-flow">
        <div><h4>Before</h4>{diff.location_deltas.slice(0, 2).map((row) => <p key={row.location_id}>{countyName(row.location_id)}: {rank(row.old_rank)} / {row.old_score}</p>)}</div>
        <div><h4 className="flex items-center gap-2"><ArrowRight size={15} />Accepted Changes</h4><dl className="space-y-2">{diff.changes.map((change) => <div key={change.field}>
          <dt className="break-words font-semibold">{change.field}</dt><dd className="break-words text-steel">{fieldValue(change.field, change.old_value)} &rarr; {fieldValue(change.field, change.new_value)}</dd>
        </div>)}</dl></div>
        <div><h4 className="flex items-center gap-2"><ArrowDown size={15} />After</h4>{diff.location_deltas.slice(0, 2).map((row) => <p key={row.location_id}>{countyName(row.location_id)}: {rank(row.new_rank)} / {row.new_score}</p>)}</div>
      </div>
      <p className="my-4 text-sm text-steel">{diff.newly_excluded_count} newly excluded / {diff.newly_feasible_count} newly eligible</p>
      <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-semibold">Entering top {diff.top_n}</dt><dd className="text-steel">{diff.entering_top_n.map(countyName).join(", ") || "None"}</dd></div>
        <div><dt className="font-semibold">Leaving top {diff.top_n}</dt><dd className="text-steel">{diff.leaving_top_n.map(countyName).join(", ") || "None"}</dd></div></dl>
      {diff.location_deltas.map((row) => <details key={row.location_id} className="record-row" open data-delta-location={row.location_id}>
        <summary>{countyName(row.location_id)}: {rank(row.old_rank)} &rarr; {rank(row.new_rank)} / score {row.old_score} &rarr; {row.new_score}</summary>
        <div className="grid gap-2 py-3 sm:grid-cols-2"><FeasibilityStatus status={row.old_feasibility} /><FeasibilityStatus status={row.new_feasibility} /></div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Factor</th><th>Normalized weight before / after</th><th>Contribution before / after</th><th>Point change</th></tr></thead><tbody>
          {row.factors.map((factor) => <tr key={factor.factor}><th>{categoryLabels[factor.factor]}</th><td>{(factor.oldWeight * 100).toFixed(2)}% &rarr; {(factor.newWeight * 100).toFixed(2)}%</td>
            <td>{factor.oldContribution} &rarr; {factor.newContribution}</td><td data-contribution-delta={`${row.location_id}:${factor.factor}`} className={factor.difference < 0 ? "text-rosewood" : "text-moss"}>{signed(factor.difference)}</td></tr>)}
        </tbody></table></div>
        <dl className="data-grid my-3">{([ ["Newly failed", row.newly_failed_constraints], ["Newly unknown", row.newly_unknown_constraints],
          ["Newly passed", row.newly_passed_constraints], ["Removed requirements", row.removed_constraints] ] as const).map(([label, values]) => <div key={label}><dt>{label}</dt><dd>{values.join(", ") || "None"}</dd></div>)}</dl>
      </details>)}
      <p className="mt-4 break-all text-xs text-steel">Same-release evaluation: {diff.data_release_id} / {diff.scoring_version}</p>
    </> : null}
  </div>;
}
