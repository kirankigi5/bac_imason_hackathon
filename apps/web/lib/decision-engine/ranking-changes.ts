import { categoryKeys, type ChangeRecord, type LocationDelta, type ProjectState, type RankedLocation, type RankingChangePayload } from "@/lib/types/domain";

export function computeRankingChanges(oldProject: ProjectState, newProject: ProjectState,
  before: RankedLocation[], after: RankedLocation[], changes: ChangeRecord[], selectedId?: string,
  options: { topN?: number; locationIds?: string[] } = {}): RankingChangePayload {
  const oldById = new Map(before.map((item) => [item.location_id, item]));
  const newById = new Map(after.map((item) => [item.location_id, item]));
  const topN = options.topN ?? 20;
  const oldTop = new Set(before.filter((row) => row.rank > 0 && row.rank <= topN).map((row) => row.location_id));
  const newTop = new Set(after.filter((row) => row.rank > 0 && row.rank <= topN).map((row) => row.location_id));
  const enteringTopN = [...newTop].filter((id) => !oldTop.has(id)), leavingTopN = [...oldTop].filter((id) => !newTop.has(id));
  const focusSize = options.topN === undefined ? 3 : topN;
  const focused = new Set([...before.filter((row) => row.rank > 0).slice(0, focusSize),
    ...after.filter((row) => row.rank > 0).slice(0, focusSize)].map((row) => row.location_id));
  for (const id of [...enteringTopN, ...leavingTopN, ...(options.locationIds ?? [])]) focused.add(id);
  if (selectedId) focused.add(selectedId);
  let newlyExcludedCount = 0, newlyFeasibleCount = 0;
  for (const [id, row] of newById) {
    const previous = oldById.get(id);
    if (previous?.feasibility.is_feasible && !row.feasibility.is_feasible) newlyExcludedCount++;
    if (previous && !previous.feasibility.is_feasible && row.feasibility.is_feasible) newlyFeasibleCount++;
  }
  return { oldProject, newProject, changes, newlyExcludedCount, newlyFeasibleCount, topN, enteringTopN, leavingTopN,
    locations: [...focused].flatMap((id) => {
      const old = oldById.get(id), next = newById.get(id);
      if (!old || !next) return [];
      return [{ locationId: id, countyName: next.county_name,
        oldRank: old.feasibility.is_feasible ? old.rank : null,
        newRank: next.feasibility.is_feasible ? next.rank : null,
        oldScore: old.overall_score, newScore: next.overall_score,
        oldWeightedContributions: { ...old.weighted_contributions }, newWeightedContributions: { ...next.weighted_contributions },
        contributionDeltas: Object.fromEntries(categoryKeys.map((factor) => [factor,
          Number((next.weighted_contributions[factor] - old.weighted_contributions[factor]).toFixed(2))])) as LocationDelta["contributionDeltas"],
        factors: categoryKeys.map((factor) => ({ factor,
          oldWeight: old.normalized_weights[factor], newWeight: next.normalized_weights[factor],
          oldContribution: old.weighted_contributions[factor], newContribution: next.weighted_contributions[factor],
          difference: Number((next.weighted_contributions[factor] - old.weighted_contributions[factor]).toFixed(2)) })),
        newlyFailedConstraints: next.feasibility.failed_constraints.filter((label) => !old.feasibility.failed_constraints.includes(label)),
        newlyPassedConstraints: old.feasibility.failed_constraints.filter((label) => !next.feasibility.failed_constraints.includes(label))
      }];
    }) };
}
