"use client";

import { ListTree, GitCompare, Database } from "lucide-react";
import { useState } from "react";
import type { Audience, DecisionTrace, LocationFeature, ProjectState, RankedLocation } from "@/lib/types/domain";
import { useAPIResource } from "@/lib/frontend/use-api-resource";
import { ExplanationTree } from "./ExplanationTree";
import { FeasibilityStatus } from "./FeasibilityStatus";
import { MetricDetails, metricLabel } from "./MetricDetails";
import { LocationSummary } from "./LocationSummary";
import { useLocationSummary } from "@/lib/frontend/use-location-summary";
import { LocationPerformance } from "@/components/scoring/LocationPerformance";

type Props = { project: ProjectState; locationId: string; selected?: RankedLocation; audience: Audience; view?: "summary" | "why" | "evidence";
  pending: boolean; onToggleCompare: (id: string) => void; onSelect: (id: string) => void; onEvidence: () => void;
  projectRevision?: number };

export function LocationDetail({ project, locationId, selected, audience, view = "summary", pending, onToggleCompare, onSelect, onEvidence, projectRevision }: Props) {
  const trace = useAPIResource<DecisionTrace>(`/api/locations/${locationId}/decision-trace`, { project });
  const feature = useAPIResource<{ location: LocationFeature }>(`/api/locations/${locationId}`, undefined, !selected);
  const [expandedContext, setExpandedContext] = useState<string>();
  const context = JSON.stringify({ locationId, project, audience, view });
  const expanded = expandedContext === context;
  const data = trace.data;
  const location = selected ?? feature.data?.location;
  const label = location ? `${location.county_name}, ${location.state_code}` : "Selected county";
  const prose = useLocationSummary(data, project, audience, location?.county_name ?? "Selected county", location?.state_code ?? "US", projectRevision, view !== "evidence");
  const comparing = project.compareLocationIds.includes(locationId);
  return <div className="location-content">
    {!data || view === "evidence" ? <header className="location-heading"><div><h2>{label}</h2>{data ? <FeasibilityStatus status={data.feasibility.status} description /> : null}</div>
      {data ? <div className="location-numbers"><div><span className="label">Rank</span><strong>{data.rank === null ? "Excluded" : `#${data.rank}`}</strong></div><div><span className="label">Screening score</span><strong>{data.overall_score}</strong></div></div> : null}
    </header> : null}
    {trace.loading ? <p role="status" className="text-steel text-sm">Loading decision trace...</p> : null}
    {trace.error ? <p role="alert">{trace.error} <button className="text-command" onClick={trace.retry}>Retry</button></p> : null}
    {feature.error ? <p role="alert">{feature.error}</p> : null}
    {data && view !== "evidence" ? <>
      <LocationSummary trace={data} project={project} audience={audience} label={label} text={prose.text} loading={prose.loading} />
      {location ? <LocationPerformance scores={location.category_scores} /> : null}
      <div className="location-actions">
        <button className="secondary-command" aria-pressed={comparing} disabled={pending || !comparing && project.compareLocationIds.length >= 4} onClick={() => onToggleCompare(locationId)}><GitCompare size={15} />{comparing ? "Remove Compare" : "Compare"}</button>
        <button className="text-command" disabled={pending} onClick={onEvidence}><Database size={15} />Evidence</button>
        <button className="text-command" disabled={pending} aria-expanded={expanded} onClick={() => setExpandedContext(expanded ? undefined : context)}><ListTree size={15} />View decision breakdown</button></div>
      {expanded ? <section className="decision-breakdown" aria-label="Decision breakdown"><ExplanationTree trace={data} project={project} onSelect={onSelect} /></section> : null}
    </> : null}
    {data && view === "evidence" ? <div className="evidence-records">{data.metrics.map((metric) => <details className="record-row" key={metric.evidence_id} data-metric={metric.metric}>
      <summary><span>{metricLabel(metric.metric)}</span><small>{metric.source || "Unavailable"} / {metric.source_as_of ?? metric.source_year ?? "Missing"} / {metric.metric_type}</small></summary>
      <MetricDetails metric={metric} evidence={data.evidence.find((item) => item.evidence_id === metric.evidence_id)} />
    </details>)}<details className="record-row"><summary>Decision trace</summary><ExplanationTree trace={data} project={project} onSelect={onSelect} /></details>
    <details className="record-row"><summary>Methodology and limitations</summary><ul className="space-y-2 mt-3 text-sm text-steel">{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      <p className="mt-4 break-all text-xs text-steel">{data.data_release_id} / {data.scoring_version} / {data.normalization_version}</p>
      <p className="mt-2 text-sm text-steel">{data.data_completeness_score}% completeness / {data.available_ranking_metrics} scoring metrics available</p>
    </details></div> : null}
  </div>;
}
