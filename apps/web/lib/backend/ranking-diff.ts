import { getStoreSnapshot, type StoreSnapshot } from "@/lib/data/store";
import { categoryKeys, type ProjectState } from "@/lib/types/domain";
import { computeRankingChanges } from "@/lib/decision-engine/ranking-changes";
import { describeProjectChanges } from "@/lib/project/state";
import { decisionCache, canonicalJSON, stableHash } from "./cache";
import { DecisionError, getRanking } from "./decisions";

export function exactProjectChanges(before: ProjectState, after: ProjectState) {
  const changes: Array<{ field: string; old_value: unknown; new_value: unknown }> = [];
  for (const field of ["capacityMw", "workloadType", "geography", "targetGoLiveYear", "planningHorizonYear", "selectedLocationId", "compareLocationIds", "activePrioritySignals"] as const) {
    if (canonicalJSON(before[field] ?? null) !== canonicalJSON(after[field] ?? null)) changes.push({ field, old_value: before[field] ?? null, new_value: after[field] ?? null });
  }
  for (const factor of categoryKeys) if (before.weights[factor] !== after.weights[factor]) changes.push({ field: "weights." + factor, old_value: before.weights[factor], new_value: after.weights[factor] });
  for (const id of new Set([...before.constraints, ...after.constraints].map((row) => row.id))) {
    const old = before.constraints.find((row) => row.id === id), next = after.constraints.find((row) => row.id === id);
    if (canonicalJSON(old ?? null) !== canonicalJSON(next ?? null)) changes.push({ field: "constraints." + id, old_value: old ?? null, new_value: next ?? null });
  }
  return changes;
}
export function rankingDiff(beforeProject: ProjectState, afterProject: ProjectState, ids: string[] = [], topN = 20, snapshot: StoreSnapshot = getStoreSnapshot()) {
  const known = new Set(snapshot.features.map((row) => row.location_id));
  for (const id of ids) if (!known.has(id)) throw new DecisionError(404, "Unknown county ID: " + id);
  const before = getRanking(beforeProject, snapshot), after = getRanking(afterProject, snapshot);
  return decisionCache.remember("diff:" + stableHash([before.ranking_hash, after.ranking_hash, beforeProject, afterProject, ids, topN]), () => {
    const old = [...before.results, ...before.excluded], next = [...after.results, ...after.excluded];
    const trace = computeRankingChanges(beforeProject, afterProject, old, next, describeProjectChanges(beforeProject, afterProject), undefined,
      { topN, locationIds: ids });
    return { data_release_id: after.data_release_id, scoring_version: after.scoring_version, normalization_version: after.normalization_version,
      before_project_hash: before.project_hash, after_project_hash: after.project_hash,
      changes: exactProjectChanges(beforeProject, afterProject), top_n: topN,
      entering_top_n: trace.enteringTopN, leaving_top_n: trace.leavingTopN,
      newly_excluded_count: trace.newlyExcludedCount, newly_feasible_count: trace.newlyFeasibleCount,
      location_deltas: trace.locations.map((row) => {
        const previous = old.find((item) => item.location_id === row.locationId)!, current = next.find((item) => item.location_id === row.locationId)!;
        return { location_id: row.locationId, old_rank: row.oldRank, new_rank: row.newRank,
          old_score: row.oldScore, new_score: row.newScore, old_feasibility: previous.feasibility.status, new_feasibility: current.feasibility.status,
          old_weighted_contributions: row.oldWeightedContributions, new_weighted_contributions: row.newWeightedContributions,
          contribution_deltas: row.contributionDeltas, factors: row.factors,
          newly_failed_constraints: current.feasibility.checks.filter((check) => check.required && check.status === "FAIL"
            && !previous.feasibility.checks.some((oldCheck) => oldCheck.id === check.id && oldCheck.status === check.status)).map((check) => check.id),
          newly_unknown_constraints: current.feasibility.checks.filter((check) => check.required && check.status === "UNKNOWN"
            && !previous.feasibility.checks.some((oldCheck) => oldCheck.id === check.id && oldCheck.status === "UNKNOWN")).map((check) => check.id),
          newly_passed_constraints: current.feasibility.checks.filter((check) => check.required && check.status === "PASS"
            && !previous.feasibility.checks.some((oldCheck) => oldCheck.id === check.id && oldCheck.status === "PASS")).map((check) => check.id),
          removed_constraints: previous.feasibility.checks.filter((check) => check.required && !current.feasibility.checks.some((nextCheck) => nextCheck.id === check.id)).map((check) => check.id) };
      }) };
  });
}
