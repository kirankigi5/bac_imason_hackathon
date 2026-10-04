import { getEvidenceForLocation, getStoreSnapshot, type StoreSnapshot } from "@/lib/data/store";
import { rankLocations } from "@/lib/decision-engine/scoring";
import { getMissingRequiredFields } from "@/lib/project/validation";
import type { ProjectState, RankingVersions } from "@/lib/types/domain";
import { decisionCache, stableHash } from "./cache";

export const SCORING_VERSION = "county-screening-v2.0.0";
export class DecisionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function requireCompleteProject(project: ProjectState) {
  const missing = getMissingRequiredFields(project);
  if (missing.length) throw new DecisionError(422, "Complete the project profile first: " + missing.join(", "));
}
export function versionsFor(snapshot: StoreSnapshot): RankingVersions {
  return { data_release_id: snapshot.manifest.store_path?.split("/").at(-1) ?? "seeded-" + stableHash(snapshot.features).slice(0, 20),
    scoring_version: SCORING_VERSION,
    normalization_version: "county-normalization-" + stableHash(snapshot.manifest.normalization ?? snapshot.manifest.input_checksums ?? snapshot.manifest.processing_version ?? "unversioned").slice(0, 20) };
}
export function projectHash(project: ProjectState) {
  const { selectedLocationId: _selected, compareLocationIds: _compare, activePrioritySignals: _signals, ...scored } = project;
  return stableHash({ ...scored, constraints: [...scored.constraints].sort((a, b) => a.id.localeCompare(b.id)),
    geography: scored.geography ? { ...scored.geography, states: scored.geography.states ? [...scored.geography.states].sort() : undefined,
      regions: scored.geography.regions ? [...scored.geography.regions].sort() : undefined } : undefined });
}
export function rankingKey(project: ProjectState, versions: RankingVersions) { return stableHash({ versions, project_hash: projectHash(project) }); }
export function getRanking(project: ProjectState, snapshot = getStoreSnapshot()) {
  const versions = versionsFor(snapshot);
  const project_hash = projectHash(project), ranking_hash = rankingKey(project, versions);
  return decisionCache.remember("ranking:" + ranking_hash, () => ({ ...rankLocations(project, snapshot.features, snapshot.features.length),
    ...versions, project_hash, ranking_hash }));
}
export function selectedLocation(project: ProjectState, id: string, snapshot = getStoreSnapshot()) {
  const ranking = getRanking(project, snapshot);
  const location = [...ranking.results, ...ranking.excluded].find((row) => row.location_id === id);
  if (!location) throw new DecisionError(404, "Unknown county ID: " + id);
  return { location, ranking, evidence: getEvidenceForLocation(id, snapshot) };
}
