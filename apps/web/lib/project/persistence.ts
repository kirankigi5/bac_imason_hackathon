import { getStoreSnapshot, type StoreSnapshot } from "@/lib/data/store";
import { DecisionError, getRanking, versionsFor } from "@/lib/backend/decisions";
import { exactProjectChanges, rankingDiff } from "@/lib/backend/ranking-diff";
import { canonicalJSON } from "@/lib/backend/cache";
import { cloneProject } from "./defaults";
import { getMissingRequiredFields } from "./validation";
import { getProjectRepository, type AuditContext, type SavedProject, type SavedRanking } from "./repository";
import type { ProjectState } from "@/lib/types/domain";

function savedRanking(project: ProjectState, snapshot: StoreSnapshot): SavedRanking | null {
  if (getMissingRequiredFields(project).length) return null;
  const ranked = getRanking(project, snapshot);
  return { ...versionsFor(snapshot), project_hash: ranked.project_hash, ranking_hash: ranked.ranking_hash,
    generated_at: new Date().toISOString(), feasible_count: ranked.results.length, excluded_count: ranked.excluded.length,
    results: ranked.results.slice(0, 20) };
}
function verifySelections(project: ProjectState, snapshot: StoreSnapshot) {
  const known = new Set(snapshot.features.map((row) => row.location_id));
  for (const id of [...project.compareLocationIds, ...(project.selectedLocationId ? [project.selectedLocationId] : [])]) {
    if (!known.has(id)) throw new DecisionError(404, "Unknown selected county ID: " + id);
  }
}
export function projectWithFreshness(record: SavedProject, snapshot = getStoreSnapshot()) {
  const missing = getMissingRequiredFields(record.project);
  const stored = record.last_ranking_snapshot;
  const current = versionsFor(snapshot);
  const versionMatch = stored && canonicalJSON({ data_release_id: stored.data_release_id, scoring_version: stored.scoring_version,
    normalization_version: stored.normalization_version }) === canonicalJSON(current);
  return { ...record, missing_required_fields: missing, ranking_snapshot_status: !stored ? "NOT_EVALUATED" : versionMatch ? "CURRENT" : "STALE", current_versions: current };
}
export function createProject(name: string, input: Partial<ProjectState> = {}, audit: AuditContext = { source: "api" }, snapshot = getStoreSnapshot()) {
  const project = cloneProject(input);
  verifySelections(project, snapshot);
  const ranking = savedRanking(project, snapshot);
  const record = getProjectRepository().create(name, project, ranking, { ...audit, versions: versionsFor(snapshot),
    interpreted_change: [{ field: "project", old_value: null, new_value: project }],
    ranking_effect_summary: { top_1_before: null, top_1_after: ranking?.results[0]?.location_id ?? null, feasible_count_after: ranking?.feasible_count ?? null } });
  return projectWithFreshness(record, snapshot);
}
export function updateProject(id: string, expectedRevision: number, patch: Partial<ProjectState>, name?: string,
  audit: AuditContext = { source: "api" }, snapshot = getStoreSnapshot()) {
  const repository = getProjectRepository(), old = repository.get(id);
  if (old.revision !== expectedRevision) throw new DecisionError(409, "Project revision changed; reload before updating");
  const project = cloneProject({ ...old.project, ...patch });
  verifySelections(project, snapshot);
  const before = savedRanking(old.project, snapshot), after = savedRanking(project, snapshot);
  const change = before && after ? rankingDiff(old.project, project, [], 20, snapshot) : null;
  const interpreted_change = exactProjectChanges(old.project, project);
  if (name && name !== old.name) interpreted_change.push({ field: "name", old_value: old.name, new_value: name });
  const record = repository.update(id, expectedRevision, name ?? old.name, project, after, { ...audit, versions: versionsFor(snapshot), interpreted_change,
    ranking_effect_summary: { baseline: "Both profiles evaluated on the same current data release", top_1_before: before?.results[0]?.location_id ?? null,
      top_1_after: after?.results[0]?.location_id ?? null, feasible_count_before: before?.feasible_count ?? null, feasible_count_after: after?.feasible_count ?? null,
      entering_top_n: change?.entering_top_n ?? [], leaving_top_n: change?.leaving_top_n ?? [],
      newly_excluded_count: change?.newly_excluded_count ?? 0, newly_feasible_count: change?.newly_feasible_count ?? 0,
      previous_saved_versions: old.last_ranking_snapshot ? { data_release_id: old.last_ranking_snapshot.data_release_id,
        scoring_version: old.last_ranking_snapshot.scoring_version, normalization_version: old.last_ranking_snapshot.normalization_version } : null } });
  return projectWithFreshness(record, snapshot);
}
