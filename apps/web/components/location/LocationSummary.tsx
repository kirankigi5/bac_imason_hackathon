import type { Audience, DecisionTrace, ProjectState } from "@/lib/types/domain";
import { buildLocationSummary } from "@/lib/frontend/location-summary";
import { buildSummaryFacts, renderSummary } from "@/lib/llm/location-summary";
import { FactorHelp } from "@/components/scoring/FactorHelp";

const feasibilityLabels = { FEASIBLE: "Feasible", CONDITIONALLY_FEASIBLE: "Conditionally Feasible",
  INSUFFICIENT_DATA: "Insufficient Data", INFEASIBLE: "Infeasible" };
export function LocationSummary({ trace, project, audience, label, text, loading = false }: { trace: DecisionTrace; project: ProjectState;
  audience: Audience; label: string; text?: string; loading?: boolean }) {
  const summary = buildLocationSummary(trace, project);
  const fallback = renderSummary(buildSummaryFacts(trace, project, label.replace(/, [A-Z]{2}$/, ""), "US"), audience);
  return <section className="location-summary" aria-label={`${audience} location explanation`} data-testid="location-summary">
    <header className="location-heading"><div><h2>{label}</h2>
      <p className="location-overview"><span>{trace.rank === null ? "Excluded" : `#${trace.rank}`}</span><span aria-hidden="true">&middot;</span>
        <span>{trace.overall_score.toFixed(1)}/100</span><span aria-hidden="true">&middot;</span>
        <span data-feasibility-status={trace.feasibility.status}>{feasibilityLabels[trace.feasibility.status]}</span></p>
    </div></header>
    <p className="summary-introduction" data-testid="main-location-explanation" aria-busy={loading}>{text ?? fallback}</p>
    <div className="selected-drivers"><div><h3>Top strengths</h3>{summary.strengths.length ? <ul>{summary.strengths.map((row) =>
      <li key={row.factor} data-summary-strength={row.factor}><span>{row.label}</span><strong>{Number(row.score.toFixed(1))}/100</strong><FactorHelp factor={row.factor} /></li>)}</ul>
      : <p>No positive weighted drivers available.</p>}</div>
      <div><h3>Main unresolved risks</h3>{summary.risks.length ? <ul>{summary.risks.map((risk) => <li key={risk.id} data-summary-risk={risk.id}>{risk.text}</li>)}</ul>
        : <p>No unresolved screening indicators reported.</p>}
        {summary.allRisks.length > 3 ? <details className="all-location-risks"><summary>View all risks</summary><ul>{summary.allRisks.slice(3).map((risk) =>
          <li key={risk.id} data-additional-risk={risk.id}>{risk.text}</li>)}</ul></details> : null}
      </div></div>
  </section>;
}
