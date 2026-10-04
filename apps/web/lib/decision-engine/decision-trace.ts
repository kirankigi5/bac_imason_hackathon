import { getStoreSnapshot, type StoreSnapshot } from "@/lib/data/store";
import { decisionCache } from "@/lib/backend/cache";
import { selectedLocation } from "@/lib/backend/decisions";
import { categoryKeys, type DecisionTrace, type ExplanationNode, type ProjectState, type TraceDriver } from "@/lib/types/domain";
import { categoryLabels } from "@/lib/project/defaults";
import { contributionMetricNames } from "./explanations";
import { metricQuality } from "./metric-quality";

export function decisionTrace(project: ProjectState, locationId: string, snapshot: StoreSnapshot = getStoreSnapshot()): DecisionTrace {
  const { location, ranking, evidence } = selectedLocation(project, locationId, snapshot);
  return decisionCache.remember(`trace:${ranking.ranking_hash}:${locationId}`, () => {
    const metrics = evidence.map(metricQuality);
    const drivers: TraceDriver[] = categoryKeys.flatMap((factor) => {
      const score = location.category_scores[factor], weight = location.normalized_weights[factor];
      if (score === null || weight <= 0) return [];
      const quality = metrics.filter((row) => row.value !== null && contributionMetricNames[factor].includes(row.metric));
      const metric_type = quality.some((row) => row.metric_type === "proxy") ? "proxy" : quality.some((row) => row.metric_type === "estimated") ? "estimated" : "measured";
      return [{ factor, score, weight, contribution: location.weighted_contributions[factor], metric_type,
        source_refs: quality.map((row) => row.evidence_id), caveat: "Positive score contribution under current weights; county screening, not site approval." }];
    });
    const positive = [...drivers].sort((a, b) => b.contribution - a.contribution || a.factor.localeCompare(b.factor)).slice(0, 3);
    const negative = [...drivers].filter((row) => row.score < 65).sort((a, b) => a.score - b.score || a.factor.localeCompare(b.factor)).slice(0, 3)
      .map((row) => ({ ...row, caveat: "Weakness: category score below 65/100. Its actual weighted contribution remains nonnegative." }));
    const feasibility = structuredClone(location.feasibility);
    feasibility.checks = feasibility.checks.map((check) => ({ ...check,
      source_refs: metrics.filter((row) => check.metric === "raw_metrics." + row.metric
        || check.metric === "category_scores." + check.factor && contributionMetricNames[check.factor as keyof typeof contributionMetricNames]?.includes(row.metric)).map((row) => row.evidence_id) }));
    const alternatives = ranking.results.filter((row) => row.location_id !== locationId).slice(0, 3).map((row) => {
      const score_delta = Number((location.overall_score - row.overall_score).toFixed(1));
      const factor_deltas = categoryKeys.map((factor) => ({ factor, impact: Number((location.weighted_contributions[factor] - row.weighted_contributions[factor]).toFixed(2)) }));
      return { location_id: row.location_id, rank: row.rank, overall_score: row.overall_score, score_delta, factor_deltas,
        rounding_delta: Number((score_delta - factor_deltas.reduce((sum, item) => sum + item.impact, 0)).toFixed(2)) };
    });
    const driverNode = (row: TraceDriver, group: string): ExplanationNode => ({ id: `${group}:${row.factor}`, kind: "driver",
      label: categoryLabels[row.factor], score: row.score, contribution: row.contribution, description: row.caveat,
      source_refs: row.source_refs, children: metrics.filter((item) => row.source_refs.includes(item.evidence_id)).map((item) => ({
        id: group + ":" + item.evidence_id, kind: "metric", label: item.metric, value: item.value, score: item.score,
        description: `${item.metric_type}; ${item.confidence}; ${item.caveat}`, source_refs: [item.evidence_id] })) });
    const warnings = [...new Set([...location.feasibility.warnings, ...location.feasibility.reasons,
      "All site-specific capacity, dedicated connectivity, parcel suitability and approval findings require independent evidence.",
      "Completeness is metric coverage, not prediction accuracy."])];
    const root: ExplanationNode = { id: "decision:" + locationId, kind: "decision",
      label: location.feasibility.is_feasible ? `Why ${location.county_name} ranks #${location.rank} in county screening` : `${location.county_name}: ${feasibility.status}`,
      score: location.overall_score, children: [
        { id: "feasibility", kind: "section", label: "Feasibility: " + feasibility.status, children: feasibility.checks.map((check) => ({
          id: "check:" + check.id, kind: "check", label: check.label + ": " + check.status, value: Array.isArray(check.value) ? check.value.join(", ") : check.value,
          description: check.threshold === undefined ? "" : `Observed ${check.metric} ${check.operator ?? "in"} ${check.threshold}`, source_refs: check.source_refs })) },
        { id: "positive-drivers", kind: "section", label: "Strongest weighted drivers", children: positive.map((row) => driverNode(row, "positive")) },
        { id: "weaknesses", kind: "section", label: "Weaknesses", children: negative.map((row) => driverNode(row, "negative")) },
        { id: "alternatives", kind: "section", label: "Comparison with alternatives", children: alternatives.map((row) => ({
          id: "alternative:" + row.location_id, kind: "comparison", label: row.location_id, score: row.overall_score,
          description: `Selected score minus alternative score: ${row.score_delta}; selected observed screening eligibility: ${location.feasibility.status}; not a site-capacity finding`,
          children: row.factor_deltas.map((item) => ({ id: `alternative:${row.location_id}:${item.factor}`, kind: "comparison",
            label: categoryLabels[item.factor], value: item.impact, description: "Selected weighted contribution minus alternative weighted contribution" })) })) },
        { id: "missing-evidence", kind: "section", label: "Missing evidence and diligence", children: [
          ...metrics.filter((row) => row.value === null).map((row): ExplanationNode => ({ id: "missing:" + row.metric, kind: "metric", label: row.metric,
            value: null, description: row.caveat, source_refs: [row.evidence_id] })),
          ...location.major_missing_evidence.map((item): ExplanationNode => ({ id: "site-missing:" + item, kind: "warning", label: item, description: "Unavailable; no site-level finding inferred." }))] },
        { id: "warnings", kind: "section", label: "Limitations", children: warnings.map((warning, index) => ({ id: "warning:" + index, kind: "warning", label: warning })) }
      ] };
    return { data_release_id: ranking.data_release_id, scoring_version: ranking.scoring_version, normalization_version: ranking.normalization_version,
      project_hash: ranking.project_hash, location_id: locationId, rank: location.feasibility.is_feasible ? location.rank : null,
      overall_score: location.overall_score, feasibility, positive_drivers: positive, negative_drivers: negative,
      warnings, missing_metrics: metrics.filter((row) => row.value === null).map((row) => row.metric),
      major_missing_evidence: location.major_missing_evidence, data_completeness_score: location.data_completeness_score,
      available_ranking_metrics: location.available_ranking_metrics, missing_ranking_metrics: location.missing_ranking_metrics,
      confidence_label: location.confidence_label, metrics, evidence: evidence.map((row, index) => ({ ...row, evidence_id: metrics[index].evidence_id })),
      alternatives, explanation_graph: { root } };
  });
}
