import { factorLabels } from "@/lib/frontend/factor-metadata";
import type { Audience, CompareResult, EvidenceItem, ExplanationPayload, ProjectState, RankedLocation } from "@/lib/types/domain";
import { categoryKeys } from "@/lib/types/domain";
import { getContributionLeaders } from "./scoring";
import { metricQuality } from "./metric-quality";

export function buildExplanationPayload(
  project: ProjectState,
  location: RankedLocation,
  evidence: EvidenceItem[],
  alternatives: RankedLocation[]
): ExplanationPayload {
  const leaders = getContributionLeaders(location);
  const negatives = [...leaders].sort((a, b) => a.score - b.score);
  return {
    project,
    location,
    evidence,
    topPositiveContributions: leaders.slice(0, 3),
    topNegativeContributions: negatives.slice(0, 3),
    nearestAlternatives: alternatives.filter((item) => item.location_id !== location.location_id).slice(0, 3),
    metricTypes: Object.fromEntries(evidence.map((item) => [item.metric_name, metricQuality(item).metric_type])),
    metric_quality: evidence.map(metricQuality),
    passedConstraints: project.constraints.filter((constraint) => {
      const item = evidence.find((record) => constraint.metric === "raw_metrics." + record.metric_name);
      const raw = constraint.metric.startsWith("raw_metrics.") ? item?.raw_value
        : constraint.metric.startsWith("category_scores.") ? location.category_scores[constraint.metric.slice(16) as keyof typeof location.category_scores] : null;
      if (typeof raw !== "number" || typeof constraint.value !== "number") return false;
      return constraint.operator === "<" ? raw < constraint.value : constraint.operator === "<=" ? raw <= constraint.value
        : constraint.operator === ">" ? raw > constraint.value : constraint.operator === ">=" ? raw >= constraint.value : raw === constraint.value;
    }),
    caveats: [
      "Grid capacity and interconnection readiness require utility validation; no MW availability is established.",
      ...(location.data_status === "estimated"
        ? ["Seeded demo values are labeled estimated."]
        : ["Official historical measurements are planning proxies; missing metrics are excluded and weights renormalized.",
          "The community score reflects ACS labor-pool context only, not community acceptance or local approval."]),
      ...location.feasibility.warnings
    ]
  };
}

export function explainConciseFromPayload(payload: ExplanationPayload, audience: Audience): string {
  const { location, project } = payload;
  const strengths = payload.topPositiveContributions.slice(0, 3).map((item) => factorLabels[item.factor]);
  const risk = [...location.risks, ...location.feasibility.warnings][0]
    ?.replace(/\s*\([^)]*\)/g, "")
    .replace(/\b\d+(?:\.\d+)?\s*\/\s*100\b/g, "")
    .replaceAll("Infrastructure & Land", factorLabels.infrastructure)
    .replaceAll("Community Readiness", factorLabels.community)
    .replace(/\s+/g, " ")
    .trim();
  const riskText = risk ? risk.split(" ").slice(0, 14).join(" ") : "No risk threshold is currently flagged";
  const communityCaveat = audience === "community" ? " Workforce & Community Context reflects labor-pool data, not jobs forecasts or resident support." : "";
  return `The strongest screened option is ${location.county_name}, ${location.state_code}, ranked #${location.rank} with a score of ${location.overall_score}/100. Its leading strengths are ${strengths.join(", ")}. Key risk: ${riskText}. The requested ${project.capacityMw ?? "unspecified"} MW is a screening input, not confirmed supply. Utility capacity and interconnection need direct validation; county-level screening does not establish parcel suitability or local approval.${communityCaveat}`;
}

export function explainFromPayload(payload: ExplanationPayload, audience: Audience): string {
  const { location, project } = payload;
  const positives = payload.topPositiveContributions
    .map((item) => `${factorLabels[item.factor]} contributes ${item.contribution.toFixed(1)} points from a ${item.score}/100 score at ${Math.round(item.weight * 100)}% weight`)
    .join("; ");
  const risks = [...location.risks, ...location.feasibility.warnings].join("; ") || "No observed indicators cross the current risk thresholds.";
  const context = location.data_status === "estimated"
    ? ""
    : " The community score reflects ACS labor-pool context only, not community acceptance or local approval. State-average energy and price indicators do not establish site-specific supply or tariffs.";
  const driverCategories = new Set(payload.topPositiveContributions.map((item) => item.factor));
  const sources = Array.from(new Set(payload.evidence
    .filter((item) => item.raw_value !== null && item.normalized_value !== null)
    .filter((item) => [...driverCategories].some((factor) => contributionMetricNames[factor].includes(item.metric_name)))
    .map((item) => `${item.metric_name}: ${item.raw_value} ${item.unit}, ${item.source_name} (${item.source_year}), ${item.geographic_scope ?? "demo proxy"}`))).join("; ");

  if (audience === "community") {
    return `${location.county_name}, ${location.state_code} ranks #${location.rank} with a ${location.overall_score}/100 site-fit score for the ${project.capacityMw ?? "unspecified"} MW project. For a community audience, the important points are water, electricity, land, and transparency: ${positives}. Current risks to discuss openly are: ${risks}. Evidence is drawn from: ${sources}. This does not claim community approval or guaranteed grid capacity; it shows the factors that need validation and mitigation.${context}`;
  }

  if (audience === "government") {
    return `${location.county_name}, ${location.state_code} ranks #${location.rank} because it aligns with the current infrastructure and sustainability weights. ${positives}. Government-facing review should focus on infrastructure requirements, water and grid impacts, approval complexity, and long-term viability. Current caveats: ${risks}. Evidence used: ${sources}.${context}`;
  }

  return `${location.county_name}, ${location.state_code} ranks #${location.rank} with an overall fit of ${location.overall_score}/100. The main drivers are: ${positives}. The main development risks are: ${risks}. Power availability is "${location.power_readiness_label}"; site-specific utility/interconnection validation is required. Evidence used: ${sources}.${context}`;
}

export const contributionMetricNames = {
  energy: ["energy_score", "grid_carbon_intensity_kgco2e_mwh", "noncombustion_generation_pct", "annual_mean_temperature_c"],
  water: ["water_score", "water_stress_current"],
  climate: ["climate_score", "wildfire_risk_index", "drought_risk_index", "flood_risk_index", "hurricane_risk_index", "extreme_heat_risk_index"],
  infrastructure: ["infrastructure_score", "fiber_coverage_pct"],
  economics: ["economics_score", "industrial_electricity_price_cents_kwh"],
  approval: ["approval_score", "approval_readiness"],
  community: ["community_score", "civilian_labor_force"]
};

export function compareLocations(locations: RankedLocation[]): CompareResult {
  const sorted = [...locations].sort((a, b) => (a.feasibility.is_feasible ? a.rank : Infinity) - (b.feasibility.is_feasible ? b.rank : Infinity)
    || a.county_name.localeCompare(b.county_name));
  const leader = sorted[0];
  const factorDeltas = categoryKeys.map((factor) => ({
    factor,
    label: factorLabels[factor],
    values: Object.fromEntries(sorted.map((location) => [location.location_id, location.category_scores[factor]]))
  }));

  const overallDeltas = Object.fromEntries(sorted.map((location) => [location.location_id, Number((location.overall_score - leader.overall_score).toFixed(1))]));
  const runnerUp = sorted[1];
  const summary = !leader.feasibility.is_feasible ? "No selected county satisfies the observed project requirements; scores are unqualified screening comparisons."
    : runnerUp && !runnerUp.feasibility.is_feasible ? `${leader.county_name} meets the observed screening requirements; ${runnerUp.county_name} is excluded regardless of its numerical score.`
    : runnerUp
    ? `${leader.county_name} leads ${runnerUp.county_name} by ${Math.abs(overallDeltas[runnerUp.location_id]).toFixed(1)} points under the current weights.`
    : `${leader.county_name} is the only selected comparison candidate.`;

  return {
    locations: sorted,
    factorDeltas,
    overallDeltas,
    summary
  };
}
