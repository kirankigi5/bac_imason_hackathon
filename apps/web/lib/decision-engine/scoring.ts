import { categoryLabels } from "@/lib/project/defaults";
import { normalizeWeights } from "@/lib/project/state";
import { categoryKeys, type CategoryKey, type DecisionWeights, type LocationFeature, type ProjectState, type RankedLocation } from "@/lib/types/domain";
import { evaluateFeasibility } from "./feasibility";
import { rankingQuality } from "./metric-quality";

export function rankLocations(project: ProjectState, locations: LocationFeature[], limit = 20): { results: RankedLocation[]; excluded: RankedLocation[] } {
  const normalizedWeights = normalizeWeights(project.weights);
  const ranked = locations.map((location) => scoreLocation(project, location, normalizedWeights));
  const feasible = ranked
    .filter((location) => location.feasibility.is_feasible)
    .sort((a, b) => b.overall_score - a.overall_score || a.county_name.localeCompare(b.county_name, "en") || a.county_fips.localeCompare(b.county_fips, "en"))
    .map((location, index) => ({ ...location, rank: index + 1 }));

  const excluded = ranked
    .filter((location) => !location.feasibility.is_feasible)
    .sort((a, b) => b.overall_score - a.overall_score || a.county_name.localeCompare(b.county_name, "en") || a.county_fips.localeCompare(b.county_fips, "en"));

  return {
    results: feasible.slice(0, limit),
    excluded
  };
}

export function scoreLocation(project: ProjectState, location: LocationFeature, normalizedWeights: DecisionWeights): RankedLocation {
  const available = categoryKeys.filter((key) => location.category_scores[key] !== null && Number.isFinite(location.category_scores[key]));
  const weightTotal = available.reduce((sum, key) => sum + normalizedWeights[key], 0);
  const activeWeights = categoryKeys.reduce((acc, key) => {
    acc[key] = available.includes(key) && weightTotal > 0 ? normalizedWeights[key] / weightTotal : 0;
    return acc;
  }, {} as DecisionWeights);
  const weighted_contributions = categoryKeys.reduce((acc, key) => {
    const score = location.category_scores[key];
    acc[key] = score === null ? 0 : Number((score * activeWeights[key]).toFixed(2));
    return acc;
  }, {} as DecisionWeights);
  const overall_score = Number(categoryKeys.reduce((sum, key) => sum + weighted_contributions[key], 0).toFixed(1));
  const feasibility = evaluateFeasibility(project, location);
  if (weightTotal <= 0) {
    feasibility.is_feasible = false;
    feasibility.failed_constraints.push("No observed metrics support the active project priorities.");
    feasibility.checks.push({ id: "active-priorities", factor: "priorities", label: "Observed metrics for active priorities",
      metric: "category_scores", status: "UNKNOWN", value: null, required: true });
    if (feasibility.status !== "INFEASIBLE") feasibility.status = "INSUFFICIENT_DATA";
    feasibility.reasons = [...feasibility.failed_constraints];
  }
  const missingCategories = categoryKeys.filter((key) => location.category_scores[key] === null);
  if (missingCategories.length) {
    feasibility.warnings.push(`Missing categories excluded and remaining weights renormalized: ${missingCategories.map((key) => categoryLabels[key]).join(", ")}.`);
  }

  const quality = rankingQuality(location);
  return {
    location_id: location.location_id,
    county_fips: location.county_fips,
    county_name: location.county_name,
    state_code: location.state_code,
    state_name: location.state_name,
    nearby_metro: location.nearby_metro,
    lat: location.lat,
    lon: location.lon,
    rank: 0,
    overall_score,
    category_scores: location.category_scores,
    weighted_contributions,
    normalized_weights: activeWeights,
    strengths: getStrengths(location),
    risks: getRisks(project, location),
    feasibility,
    data_completeness_score: location.data_completeness_score,
    ...quality,
    confidence_label: feasibility.status === "INSUFFICIENT_DATA" ? "INSUFFICIENT_DATA" : quality.confidence_label,
    power_readiness_label: location.power_readiness_label,
    capacity_pressure_score: location.capacity_pressure_score,
    missing_metrics: location.missing_metrics,
    data_status: location.data_status,
    notes: location.notes
  };
}

function getStrengths(location: LocationFeature): string[] {
  return categoryKeys
    .filter((key) => location.category_scores[key] !== null && location.category_scores[key]! >= 75)
    .sort((a, b) => location.category_scores[b]! - location.category_scores[a]!)
    .slice(0, 4)
    .map((key) => `${categoryLabels[key]} (${location.category_scores[key]}/100)`);
}

function getRisks(project: ProjectState, location: LocationFeature): string[] {
  const risks: string[] = [];
  for (const key of categoryKeys) {
    const score = location.category_scores[key];
    if (score !== null && score < 65) risks.push(`${categoryLabels[key]} is weaker (${score}/100)`);
  }
  if (location.capacity_pressure_score !== null && location.capacity_pressure_score > 65) risks.push(`Capacity pressure proxy is elevated (${location.capacity_pressure_score}/100)`);
  if (project.capacityMw && project.capacityMw >= 700 && location.grid_readiness_score !== null && location.grid_readiness_score < 80) {
    risks.push(`Large-capacity project needs utility validation; grid readiness proxy is ${location.grid_readiness_score}/100`);
  }
  return risks.slice(0, 5);
}

export function getContributionLeaders(location: RankedLocation): Array<{ factor: CategoryKey; score: number; weight: number; contribution: number }> {
  return categoryKeys
    .flatMap((factor) => {
      const score = location.category_scores[factor];
      return score === null || location.normalized_weights[factor] === 0 ? [] : [{
        factor, score, weight: location.normalized_weights[factor], contribution: location.weighted_contributions[factor]
      }];
    })
    .sort((a, b) => b.contribution - a.contribution);
}
