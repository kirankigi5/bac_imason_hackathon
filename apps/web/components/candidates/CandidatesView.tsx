"use client";

import { useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { categoryKeys, type CategoryKey, type RankedLocation } from "@/lib/types/domain";
import { factorLabels } from "@/lib/frontend/factor-metadata";
import { stateAliases } from "@/lib/project/geography";
import { useCandidates } from "@/lib/frontend/use-candidates";
import type { CandidatesRequest } from "@/app/actions/candidates";

const pageSize = 50;
const statusLabels = { FEASIBLE: "Feasible", CONDITIONALLY_FEASIBLE: "Conditionally Feasible", INSUFFICIENT_DATA: "Insufficient Data", INFEASIBLE: "Infeasible" };
const searchText = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function matchesCandidate(row: RankedLocation, query: string) {
  const text = searchText(query);
  const state = stateAliases[text] ?? (Object.values(stateAliases).includes(text.toUpperCase()) ? text.toUpperCase() : undefined);
  return state ? row.state_code === state : text.split(/\s+/).every((word) => searchText(`${row.county_name} ${row.state_name} ${row.state_code}`).includes(word));
}
function strongestFactors(row: RankedLocation): CategoryKey[] {
  return categoryKeys.filter((factor) => row.category_scores[factor] !== null && row.weighted_contributions[factor] > 0)
    .sort((a, b) => row.weighted_contributions[b] - row.weighted_contributions[a]).slice(0, 3);
}
export function CandidatesView({ request, pending, onSelect }: { request: CandidatesRequest; pending: boolean; onSelect: (row: RankedLocation) => void }) {
  const resource = useCandidates(request);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const excluded = request.mode === "excluded";
  const candidates = (resource.data?.results ?? []).filter((row) => row.feasibility.is_feasible !== excluded)
    .filter((row) => matchesCandidate(row, query)).sort((a, b) => excluded ? 0 : a.rank - b.rank);
  const lastPage = Math.max(0, Math.ceil(candidates.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  return <div className="all-candidates-view">
    <label className="candidate-search"><Search size={16} /><input type="search" className="field" aria-label="Search candidates" placeholder="County or state" value={query}
      onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label>
    {resource.loading ? <p className="candidate-list-status" role="status">Loading current candidates...</p> : null}
    {resource.error ? <div className="candidate-list-status" role="alert"><p>{resource.error}</p><button type="button" className="secondary-command" onClick={resource.retry}><RefreshCw size={14} />Retry</button></div> : null}
    {resource.data ? <>
      <p className="candidate-list-count" aria-live="polite">{candidates.length} {excluded ? candidates.length === 1 ? "excluded county" : "excluded counties" : candidates.length === 1 ? "ranked candidate" : "ranked candidates"}{query.trim() ? " matching search" : ""}</p>
      {!candidates.length ? <p className="empty-state">{query.trim() ? "No counties match this search." : excluded ? "No excluded counties in the current scope." : "No eligible counties under the current criteria."}</p> : null}
      <ol className="all-candidates-list" aria-label={excluded ? "Excluded counties" : "All ranked candidates"}>
        {candidates.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((row) => <li key={row.location_id} data-candidate-id={row.location_id} data-candidate-rank={excluded ? undefined : row.rank}>
          <div className="candidate-list-main"><div><h3>{!excluded ? <span>#{row.rank} </span> : null}{row.county_name}, {row.state_code}</h3>
            <p><span>{row.overall_score}/100</span><span data-candidate-status={row.feasibility.status}>{statusLabels[row.feasibility.status]}</span></p></div>
            <button type="button" className="secondary-command" aria-label={`View ${row.county_name}, ${row.state_code}`} disabled={pending} onClick={() => onSelect(row)}>View<ArrowRight size={14} /></button>
          </div>
          <ul className="candidate-list-factors">{strongestFactors(row).map((factor) => <li key={factor}>{factorLabels[factor]} <strong>{Number(row.category_scores[factor]!.toFixed(1))}/100</strong></li>)}</ul>
          {row.feasibility.status === "CONDITIONALLY_FEASIBLE" ? <p className="candidate-list-warning">Screening only; site-specific feasibility still requires verification.</p>
            : row.feasibility.status === "INSUFFICIENT_DATA" ? <p className="candidate-list-warning">Required evidence is missing; this county is not eligible.</p> : null}
        </li>)}
      </ol>
      {candidates.length > pageSize ? <nav className="candidate-list-pages" aria-label="Candidate pages"><span>{currentPage * pageSize + 1}-{Math.min((currentPage + 1) * pageSize, candidates.length)} of {candidates.length}</span>
        <button type="button" className="icon-button" aria-label="Previous candidates" title="Previous candidates" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button>
        <button type="button" className="icon-button" aria-label="Next candidates" title="Next candidates" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></nav> : null}
    </> : null}
  </div>;
}
