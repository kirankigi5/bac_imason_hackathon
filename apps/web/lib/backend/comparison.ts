import { getEvidenceForLocation, getStoreSnapshot, type StoreSnapshot } from "@/lib/data/store";
import { categoryKeys, type ProjectState } from "@/lib/types/domain";
import { compareLocations } from "@/lib/decision-engine/explanations";
import { metricQuality } from "@/lib/decision-engine/metric-quality";
import { decisionCache, stableHash } from "./cache";
import { DecisionError, getRanking } from "./decisions";

export function comparison(project: ProjectState, ids: string[], snapshot: StoreSnapshot = getStoreSnapshot()) {
  const ranking = getRanking(project, snapshot);
  const all = new Map([...ranking.results, ...ranking.excluded].map((row) => [row.location_id, row]));
  for (const id of ids) if (!all.has(id)) throw new DecisionError(404, "Unknown county ID: " + id);
  return decisionCache.remember("comparison:" + stableHash([ranking.ranking_hash, ids]), () => {
    const selected = ids.map((id) => all.get(id)!);
    const pairs = selected.flatMap((a, index) => selected.slice(index + 1).map((b) => {
      const score_delta = Number((a.overall_score - b.overall_score).toFixed(1));
      const factor_deltas = categoryKeys.map((factor) => ({ factor, a_score: a.category_scores[factor], b_score: b.category_scores[factor],
        a_weight: a.normalized_weights[factor], b_weight: b.normalized_weights[factor],
        a_contribution: a.weighted_contributions[factor], b_contribution: b.weighted_contributions[factor],
        impact: Number((a.weighted_contributions[factor] - b.weighted_contributions[factor]).toFixed(2)) }));
      const sorted = [...factor_deltas].sort((x, y) => y.impact - x.impact || x.factor.localeCompare(y.factor));
      const winner = a.feasibility.is_feasible && b.feasibility.is_feasible ? a.rank < b.rank ? a.location_id : b.location_id
        : a.feasibility.is_feasible ? a.location_id : b.feasibility.is_feasible ? b.location_id : null;
      return { pair: [a.location_id, b.location_id], score_delta, factor_deltas,
        rounding_delta: Number((score_delta - factor_deltas.reduce((sum, row) => sum + row.impact, 0)).toFixed(2)),
        top_advantage: sorted.find((row) => row.impact > 0) ?? null,
        top_disadvantage: [...sorted].reverse().find((row) => row.impact < 0) ?? null,
        why_a_beats_b: { winner, scope: "county_screening", eligibility_a: a.feasibility.status, eligibility_b: b.feasibility.status,
          reason: winner === null ? "Neither county meets the observed requirements; numerical score differences are not recommendations."
            : a.feasibility.is_feasible !== b.feasibility.is_feasible ? "Observed eligibility takes precedence over numerical score."
              : score_delta === 0 ? "Scores tie at displayed precision; deterministic county-name ordering decides rank."
                : "Winner has the higher deterministic weighted screening score under the same project." } };
    }));
    const legacy = compareLocations(selected);
    return { ...legacy, data_release_id: ranking.data_release_id, scoring_version: ranking.scoring_version,
      normalization_version: ranking.normalization_version, project_hash: ranking.project_hash,
      locations: legacy.locations.map((row) => ({ ...row, raw_values: snapshot.features.find((item) => item.location_id === row.location_id)!.raw_metrics,
        metric_quality: getEvidenceForLocation(row.location_id, snapshot).map(metricQuality) })), pairwise: pairs,
      caveats: ["Score deltas are directional: first county minus second. Different available metrics can renormalize county weights.",
        "Rounded contribution deltas plus rounding_delta reproduce the displayed overall score difference.",
        "Completeness is coverage, not prediction accuracy. County screening does not establish dedicated fiber, utility approval, tariffs or parcel suitability."] };
  });
}
