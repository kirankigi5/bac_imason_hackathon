"use client";

import { useState } from "react";
import { FileQuestion, X } from "lucide-react";
import type { Audience, DecisionTrace, ProjectState, ProviderStatus } from "@/lib/types/domain";
import type { Comparison } from "@/lib/frontend/contracts";
import { useAPIResource } from "@/lib/frontend/use-api-resource";
import { categoryKeys } from "@/lib/types/domain";
import { factorLabels as categoryLabels, locationScore } from "@/lib/frontend/factor-metadata";
import { FeasibilityStatus } from "@/components/location/FeasibilityStatus";
import { MetricDetails, displayValue, metricLabel } from "@/components/location/MetricDetails";
import { signed } from "@/components/changes/RankingDiffPanel";

type Props = { project: ProjectState; locationIds: string[]; audience: Audience; pending?: boolean;
  onRemove: (id: string) => void; onClear: () => void };
export function ComparePanel({ project, locationIds, audience, pending, onRemove, onClear }: Props) {
  const resource = useAPIResource<Comparison>("/api/compare", { project, location_ids: locationIds }, locationIds.length >= 2);
  const [pairIndex, setPairIndex] = useState(0);
  const [asked, setAsked] = useState("");
  const data = resource.data;
  const pair = data?.pairwise[Math.min(pairIndex, data.pairwise.length - 1)];
  const scope = JSON.stringify([project, pair?.pair]);
  const prose = useAPIResource<{ explanation: string; provider: ProviderStatus; decision_trace: DecisionTrace }>(`/api/locations/${pair?.pair[0]}/explain`,
    { project, audience, question: "why_not_second", comparisonLocationId: pair?.pair[1] }, !!pair && asked === scope);
  const countyName = (id: string) => { const row = data?.locations.find((item) => item.location_id === id); return row ? `${row.county_name}, ${row.state_code}` : id; };

  return <div>
    <div className="panel-heading"><h3>Why Not Another County?</h3><button className="icon-button" title="Clear comparison" aria-label="Clear comparison" disabled={pending || !locationIds.length} onClick={onClear}><X size={16} /></button></div>
    <div className="mb-4 flex flex-wrap gap-2">{locationIds.map((id) => <button key={id} className="text-command" disabled={pending} onClick={() => onRemove(id)}><X size={13} />{countyName(id)}</button>)}</div>
    {locationIds.length < 2 ? <p className="empty-state">Select at least two counties for comparison.</p> : null}
    {resource.loading ? <p role="status">Loading county comparison...</p> : null}
    {resource.error ? <p role="alert">{resource.error} <button className="text-command" onClick={resource.retry}>Retry</button></p> : null}
    {data && pair ? <>
      <div className="table-scroll"><table className="data-table" data-testid="comparison-table"><thead><tr><th>County screening</th>{data.locations.map((row) => <th key={row.location_id}>{row.county_name}, {row.state_code}</th>)}</tr></thead><tbody>
        <tr><th>Rank / score</th>{data.locations.map((row) => <td key={row.location_id}>{row.feasibility.is_feasible ? `#${row.rank}` : "Excluded"} / {row.overall_score}</td>)}</tr>
        <tr><th>Feasibility</th>{data.locations.map((row) => <td key={row.location_id}><FeasibilityStatus status={row.feasibility.status} /></td>)}</tr>
        {categoryKeys.map((factor) => <tr key={factor}><th>{categoryLabels[factor]}</th>{data.locations.map((row) => <td key={row.location_id}>
          <div>{locationScore(factor, row.category_scores[factor])}</div><div className="text-xs text-steel">{row.weighted_contributions[factor]} points / {row.normalized_weights[factor].toFixed(4)} effective weight</div>
        </td>)}</tr>)}
      </tbody></table></div>
      <div className="my-5 flex flex-wrap items-center gap-3"><label className="min-w-0 text-sm font-semibold">Pair
        <select aria-label="Comparison pair" className="field ml-2 max-w-full" value={Math.min(pairIndex, data.pairwise.length - 1)} onChange={(event) => setPairIndex(Number(event.target.value))}>
          {data.pairwise.map((item, index) => <option key={item.pair.join(":")} value={index}>{countyName(item.pair[0])} / {countyName(item.pair[1])}</option>)}
        </select></label></div>
      <h4 className="mb-2 text-sm font-bold" data-testid="pairwise-score">{countyName(pair.pair[0])} minus {countyName(pair.pair[1])}: {signed(pair.score_delta)} points</h4>
      <p className="mb-3 text-sm text-steel">{pair.why_a_beats_b.winner ? `Screening winner: ${countyName(pair.why_a_beats_b.winner)}. ` : ""}{pair.why_a_beats_b.reason}</p>
      <dl className="pairwise-deltas">{pair.factor_deltas.map((factor) => <div key={factor.factor}><dt>{categoryLabels[factor.factor]}</dt><dd data-pairwise-factor={factor.factor} className={factor.impact < 0 ? "text-rosewood" : "text-moss"}>{signed(factor.impact)}</dd></div>)}
        <div><dt>Rounding adjustment</dt><dd>{signed(pair.rounding_delta)}</dd></div></dl>
      <button className="text-command my-4" disabled={prose.loading} onClick={() => { if (asked === scope) prose.retry(); else setAsked(scope); }}><FileQuestion size={16} />{prose.loading ? "Explaining..." : "Explain Comparison"}</button>
      {prose.error ? <p role="alert">{prose.error}</p> : null}
      {prose.data ? <div><h4 className="text-sm font-semibold capitalize">{audience} explanation / {prose.data.provider.mode}</h4><p className="mt-2 whitespace-pre-line text-sm leading-6">{prose.data.explanation}</p></div> : null}
      <details className="record-row mt-4"><summary>Raw Values and Evidence Quality</summary>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Metric</th>{data.locations.map((row) => <th key={row.location_id}>{row.county_name}</th>)}</tr></thead><tbody>
          {[...new Set(data.locations.flatMap((row) => row.metric_quality.map((item) => item.metric)))].map((metric) => <tr key={metric}><th>{metricLabel(metric)}</th>{data.locations.map((row) => {
            const quality = row.metric_quality.find((item) => item.metric === metric);
            return <td key={row.location_id}>{quality ? <details><summary>{displayValue(quality.value)}{quality.value === null ? "" : ` ${quality.unit}`} / {quality.metric_type}</summary><MetricDetails metric={quality} /></details> : "Missing"}</td>;
          })}</tr>)}
        </tbody></table></div>
      </details>
      <ul className="mt-4 space-y-1 text-xs text-steel">{data.caveats.map((text) => <li key={text}>{text}</li>)}</ul>
    </> : null}
  </div>;
}
