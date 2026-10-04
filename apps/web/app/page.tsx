"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Globe2, History, Plus, RefreshCw, Save, X } from "lucide-react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ComparePanel } from "@/components/compare/ComparePanel";
import { RankingDiffPanel } from "@/components/changes/RankingDiffPanel";
import { TopProfileBar } from "@/components/filters/TopProfileBar";
import { CriteriaEditor } from "@/components/filters/CriteriaEditor";
import { StateSelector, geographyLabel } from "@/components/filters/StateSelector";
import { LocationDetail } from "@/components/location/LocationDetail";
import { AudienceControl } from "@/components/location/AudienceControl";
import { DecisionMap } from "@/components/map/DecisionMap";
import { ProjectToolbar } from "@/components/projects/ProjectToolbar";
import { DecisionHistory } from "@/components/projects/DecisionHistory";
import { Dialog } from "@/components/workspace/Dialog";
import { useWorkspace } from "@/lib/frontend/use-workspace";
import { useAPIResource } from "@/lib/frontend/use-api-resource";
import type { RankingDiff } from "@/lib/frontend/contracts";
import type { CategoryKey, Geography } from "@/lib/types/domain";
import { changeLabel } from "@/lib/frontend/factor-metadata";
import { CandidatesView } from "@/components/candidates/CandidatesView";
import type { RankedLocation } from "@/lib/types/domain";

type View = "criteria" | "states" | "saved" | "project" | "history" | "why" | "compare" | "evidence" | "changes" | "candidates" | "excluded";
const titles: Record<View, string> = { criteria: "Edit Criteria", states: "Choose States", saved: "Saved Projects", project: "Project", history: "Decision History", why: "Why this location?", compare: "Compare Counties", evidence: "Source Evidence", changes: "Why did this change?", candidates: "All Ranked Candidates", excluded: "Excluded Counties" };

export default function Home() {
  const workspace = useWorkspace();
  const [view, setView] = useState<View>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [scope, setScope] = useState<Geography>({ country: "US" });
  const [countyQuery, setCountyQuery] = useState("");
  const [dismissedChange, setDismissedChange] = useState<unknown>();
  const selectedPanel = useRef<HTMLElement>(null);
  const focusSelected = useRef(false);
  const [pickedCandidate, setPickedCandidate] = useState<{ criteria: string; row: RankedLocation }>();
  const { selectedLocationId: _selection, compareLocationIds: _comparison, ...criteria } = workspace.project;
  const criteriaKey = JSON.stringify([criteria, workspace.search?.data_release_id, workspace.search?.scoring_version, workspace.search?.normalization_version]);
  const ready = !!workspace.search;
  const results = workspace.search?.results ?? [], excluded = workspace.search?.excluded ?? [];
  const known = useMemo(() => new Map([...results, ...excluded,
    ...(pickedCandidate?.criteria === criteriaKey ? [pickedCandidate.row] : [])].map((row) => [row.location_id, row])), [results, excluded, pickedCandidate, criteriaKey]);
  const selected = workspace.selectedId ? known.get(workspace.selectedId) : undefined;
  const choices = [...known.values()].filter((row) => `${row.county_name} ${row.state_code} ${row.county_fips}`.toLowerCase().includes(countyQuery.toLowerCase())).slice(0, 60);
  const countyName = (id: string) => { const row = known.get(id); return row ? `${row.county_name}, ${row.state_code}` : `County FIPS ${id.replace("county-", "")}`; };
  const context = workspace.diffContext;
  const diff = useAPIResource<RankingDiff>("/api/ranking/diff", context ? { before_project: context.before, after_project: context.after,
    location_ids: [...new Set([...context.ids, ...(workspace.selectedId ? [workspace.selectedId] : [])])], top_n: 20 } : undefined, view === "changes" && !!context);
  const select = (id: string) => { void workspace.selectLocation(id); setDetailOpen(true); };
  const selectCandidate = async (row: RankedLocation) => {
    if (await workspace.selectLocation(row.location_id)) {
      setPickedCandidate({ criteria: criteriaKey, row }); setCountyQuery("");
      focusSelected.current = true; setDetailOpen(true); setView(undefined);
    }
  };
  const newProject = () => { workspace.newProject(); setView(undefined); setDetailOpen(false); setCountyQuery(""); setPickedCandidate(undefined); };
  const openProject = async (id: string) => { if (await workspace.openProject(id)) { setView(undefined); setDetailOpen(false); setCountyQuery(""); setPickedCandidate(undefined); } };
  const reloadSaved = () => { if (workspace.saved) void openProject(workspace.saved.id); };
  useEffect(() => {
    const response = workspace.explanationRequest;
    if (response?.explanationPayload && response.question === "why_here") { setDetailOpen(true); setView("why"); }
    else if (response?.question === "ranking_change" && workspace.diffContext) setView("changes");
  }, [workspace.explanationRequest]);
  useEffect(() => { if (!ready) setDetailOpen(false); }, [ready]);
  useEffect(() => { if (detailOpen) selectedPanel.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" }); }, [detailOpen, workspace.project.selectedLocationId]);
  useEffect(() => {
    if (detailOpen && !view && focusSelected.current && selectedPanel.current) {
      focusSelected.current = false; selectedPanel.current.focus({ preventScroll: true });
    }
  }, [detailOpen, view, workspace.selectedId]);
  const showChange = workspace.lastChange && workspace.lastChange !== dismissedChange;
  const highlightedChanges = workspace.lastChange?.changes.filter((change) => change.changeType !== "weight" || context
    && context.after.weights[change.field.slice(8) as CategoryKey] > context.before.weights[change.field.slice(8) as CategoryKey]);
  const conciseChanges = [...(highlightedChanges ?? []), ...(workspace.lastChange?.changes.filter((change) => !highlightedChanges?.includes(change)) ?? [])].slice(0, 3);
  const detailProps = { project: workspace.project, selected, locationId: workspace.selectedId!, audience: workspace.audience,
    projectRevision: workspace.saved?.revision,
    pending: workspace.pending, onSelect: (id: string) => { select(id); setView(undefined); }, onEvidence: () => setView("evidence"),
    onToggleCompare: (id: string) => { void workspace.toggleCompare(id); } };

  return <main className="decision-app" data-stage={ready ? "workspace" : "intake"}>
    <ProjectToolbar name={workspace.name} ready={ready} pending={workspace.pending} savedView={view === "saved"} onPlanner={() => setView(undefined)}
      onSaved={() => { setView("saved"); void workspace.refreshProjects(); }} onProject={() => setView("project")} onSave={workspace.saveProject} />
    {workspace.error && !view ? <div className="error-banner" role="alert">{workspace.error}{workspace.saved ? <button className="text-command ml-3" disabled={workspace.pending} onClick={reloadSaved}>Reload saved state</button> : null}</div> : null}
    {ready ? <TopProfileBar project={workspace.project} disabled={workspace.pending} onEdit={() => setView("criteria")} /> : null}
    {workspace.saved?.ranking_snapshot_status === "STALE" ? <p className="stale-notice">Saved ranking is stale. The map uses the current release; save to refresh the stored snapshot.</p> : null}
    {showChange ? <section className="change-notification" aria-label="Accepted criteria changes" aria-live="polite">
      <div><strong>Updated</strong><span>{conciseChanges.map((change) => `${changeLabel(change.field, change.label)}: ${change.oldValue ?? "None"} -> ${change.newValue ?? "None"}`).join(" / ")}</span>
        {workspace.lastChange!.rankingChange?.locations.filter((row) => row.oldRank !== row.newRank && (row.oldRank === 1 || row.newRank === 1)).map((row) => <small key={row.locationId}>{row.countyName}: {row.oldRank === null ? "Excluded" : `#${row.oldRank}`} &rarr; {row.newRank === null ? "Excluded" : `#${row.newRank}`}</small>)}</div>
      <button className="text-command" onClick={() => setView("changes")}>Why did this change?<ArrowRight size={14} /></button>
      <button className="icon-button" aria-label="Dismiss criteria changes" title="Dismiss" onClick={() => setDismissedChange(workspace.lastChange)}><X size={14} /></button>
    </section> : null}
    <div className="stage-content">
      {ready ? <section className="map-workspace" aria-label="Decision map workspace">
        <div className="map-heading"><div><h1>Candidate locations</h1><span>{results.length} shortlisted / {workspace.search!.feasibleCount} eligible</span></div>
          <span className="data-mode-label">{workspace.search!.dataMode === "public_data" ? "Public feature store" : "Seeded demo data"}</span>
        </div>
        <DecisionMap results={results} excluded={excluded} selectedLocationId={workspace.selectedId} onSelect={select} disabled={workspace.pending} project={workspace.project} />
        <div className="candidate-strip" role="region" aria-label="Ranked candidates">{results.slice(0, 5).map((row) => <button key={row.location_id} disabled={workspace.pending} aria-pressed={workspace.selectedId === row.location_id} onClick={() => select(row.location_id)}>
          <span className="candidate-rank">{row.rank}</span><span className="candidate-name">{row.county_name}<small>{row.state_name}</small></span><strong>{row.overall_score}</strong>
        </button>)}</div>
        <div className="map-footer"><span>County screening does not establish site approval or guaranteed MW.</span>
          <button className="text-command" disabled={workspace.pending} onClick={() => setView("candidates")}>View All Candidates<ArrowRight size={14} /></button>
          {excluded.some((row) => !workspace.project.geography?.states?.length || workspace.project.geography.states.includes(row.state_code)) ? <button className="text-command" disabled={workspace.pending} onClick={() => setView("excluded")}>View Excluded Counties<ArrowRight size={14} /></button> : null}
          {workspace.project.compareLocationIds.length ? <button className="text-command" onClick={() => setView("compare")}>Compare ({workspace.project.compareLocationIds.length})</button> : null}
        </div>
      </section> : null}
      <div className="conversation-workspace" key="conversation"><ChatPanel messages={workspace.messages} pending={workspace.pending} onSend={workspace.sendMessage} intake={!ready} /></div>
    </div>
    {!ready ? <div className="intake-geography"><Globe2 size={15} /><span>United States</span><span className="text-steel">{geographyLabel(workspace.project.geography)}</span>
      <button className="text-command" disabled={workspace.pending} onClick={() => { setScope({ ...workspace.project.geography, country: "US" }); setView("states"); }}>Choose States</button></div> : null}
    {ready && detailOpen && workspace.selectedId ? <section ref={selectedPanel} tabIndex={-1} className="selected-workspace" aria-label="Selected county details">
      <div className="selected-toolbar"><div className="county-picker"><input type="search" className="field" aria-label="Find county" placeholder="Find a county" value={countyQuery} onChange={(event) => setCountyQuery(event.target.value)} />
        <select className="field" aria-label="Selected county" value={workspace.selectedId} disabled={workspace.pending} onChange={(event) => select(event.target.value)}>
          {!choices.some((row) => row.location_id === workspace.selectedId) ? <option value={workspace.selectedId}>{countyName(workspace.selectedId)}</option> : null}
          {choices.map((row) => <option key={row.location_id} value={row.location_id}>{row.county_name}, {row.state_code} / {row.feasibility.is_feasible ? `#${row.rank}` : row.feasibility.status}</option>)}
        </select></div><AudienceControl audience={workspace.audience} onChange={workspace.setAudience} disabled={workspace.pending} />
        <button className="icon-button" aria-label="Close county details" title="Close county details" onClick={() => setDetailOpen(false)}><X size={16} /></button></div>
      <LocationDetail {...detailProps} />
    </section> : null}
    {view ? <Dialog title={titles[view]} wide={["why", "compare", "evidence", "changes", "history", "candidates", "excluded"].includes(view)} drawer={view === "criteria"} onClose={() => setView(undefined)}>
      {workspace.error ? <p className="error-banner" role="alert">{workspace.error}{workspace.saved ? <button className="text-command ml-3" disabled={workspace.pending} onClick={reloadSaved}>Reload saved state</button> : null}</p> : null}
      {view === "criteria" ? <CriteriaEditor project={workspace.project} pending={workspace.pending} onApply={async (next) => { const applied = await workspace.updateCriteria(next); if (applied) setView(undefined); return applied; }} /> : null}
      {view === "candidates" || view === "excluded" ? <CandidatesView key={`${workspace.saved?.id ?? "unsaved"}:${workspace.saved?.revision ?? 0}:${criteriaKey}:${view}`}
        request={{ project: workspace.project, ...(workspace.saved ? { projectId: workspace.saved.id, revision: workspace.saved.revision } : {}), mode: view === "candidates" ? "ranked" : "excluded" }}
        pending={workspace.pending} onSelect={selectCandidate} /> : null}
      {view === "states" ? <><StateSelector geography={scope} onChange={setScope} /><div className="dialog-actions"><button className="primary-command" disabled={workspace.pending} onClick={async () => { if (await workspace.updateGeography(scope)) setView(undefined); }}>Apply States</button></div></> : null}
      {view === "saved" ? <div className="saved-projects">{workspace.projects.length ? workspace.projects.map((record) => <article key={record.id}><div><h3>{record.name}</h3><time dateTime={record.updated_at}>{new Date(record.updated_at).toLocaleString()}</time><span>Snapshot: {record.ranking_snapshot_status}</span></div>
        <button className="secondary-command" disabled={workspace.pending} aria-label={`Open ${record.name}`} onClick={() => openProject(record.id)}>Open<ArrowRight size={15} /></button></article>) : <p className="empty-state">No saved projects.</p>}</div> : null}
      {view === "project" ? <div className="project-settings"><label>Project name<input className="field" aria-label="Project name" value={workspace.name} maxLength={120} disabled={workspace.pending} onChange={(event) => workspace.setName(event.target.value)} /></label>
        <div className="project-settings-actions"><button className="primary-command" disabled={workspace.pending || !workspace.name.trim()} onClick={workspace.saveProject}><Save size={15} />Save project</button>
          <button className="secondary-command" disabled={workspace.pending} onClick={newProject}><Plus size={15} />New project</button>
          <button className="secondary-command" onClick={() => setView("history")}><History size={15} />History</button></div>
        {workspace.saved ? <div className="project-metadata"><span>Revision {workspace.saved.revision}</span><span>Snapshot: <strong>{workspace.saved.ranking_snapshot_status}</strong></span><time dateTime={workspace.saved.updated_at}>{new Date(workspace.saved.updated_at).toLocaleString()}</time>
          <button className="text-command" disabled={workspace.pending} aria-label="Reload saved project" onClick={() => workspace.openProject(workspace.saved!.id)}><RefreshCw size={14} />Reload saved project</button></div> : null}
        <details className="record-row"><summary>Service status</summary><p className="mt-3 text-sm text-steel">{workspace.provider?.mode === "fallback" ? "Rule-based fallback" : workspace.provider ? `${workspace.provider.provider} LLM` : "AI status pending"}</p><p className="text-xs text-steel">{workspace.provider?.reason}</p></details>
      </div> : null}
      {view === "history" ? <DecisionHistory saved={workspace.saved} countyName={countyName} /> : null}
      {view === "why" || view === "compare" ? <AudienceControl audience={workspace.audience} onChange={workspace.setAudience} disabled={workspace.pending} /> : null}
      {(view === "why" || view === "evidence") && workspace.selectedId ? <LocationDetail {...detailProps} view={view} /> : null}
      {view === "compare" ? <ComparePanel project={workspace.project} locationIds={workspace.project.compareLocationIds} audience={workspace.audience} pending={workspace.pending} onRemove={workspace.toggleCompare} onClear={workspace.clearCompare} /> : null}
      {view === "changes" ? <RankingDiffPanel diff={diff.data} loading={diff.loading} error={diff.error} onRetry={diff.retry} countyName={countyName} /> : null}
    </Dialog> : null}
  </main>;
}
