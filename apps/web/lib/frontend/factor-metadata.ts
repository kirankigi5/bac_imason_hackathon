import { categoryKeys, type CategoryKey } from "@/lib/types/domain";

export type FactorMetadata = {
  factor_id: CategoryKey;
  display_name: string;
  short_description: string;
  priority_meaning: string;
  score_meaning: string;
  score_zero_meaning: string;
  score_hundred_meaning: string;
  underlying_metrics: readonly string[];
  source_summary: string;
  proxy_caveat: string;
  available: boolean;
  category: CategoryKey;
};

export const factorMetadata: Record<CategoryKey, FactorMetadata> = {
  energy: {
    factor_id: "energy", category: "energy", display_name: "Power & Clean Energy", available: true,
    short_description: "County-level power and clean-energy screening context.",
    priority_meaning: "How important are cleaner and more favorable power conditions to me?",
    score_meaning: "Higher means more favorable county-level power and clean-energy screening indicators.",
    score_zero_meaning: "Less favorable observed power and clean-energy screening context.",
    score_hundred_meaning: "More favorable observed power and clean-energy screening context.",
    underlying_metrics: ["grid_carbon_intensity_kgco2e_mwh", "noncombustion_generation_pct", "annual_mean_temperature_c"],
    source_summary: "EPA eGRID state-level emissions and generation mix; NOAA county temperature normals.",
    proxy_caveat: "This does not establish that the requested MW is actually available at a site."
  },
  water: {
    factor_id: "water", category: "water", display_name: "Water Resilience", available: true,
    short_description: "Water-stress screening context.",
    priority_meaning: "How important is avoiding water-constrained locations?",
    score_meaning: "Higher means more favorable water-stress conditions.",
    score_zero_meaning: "Severe or unfavorable water-stress screening context.",
    score_hundred_meaning: "Very favorable or low observed water-stress screening context.",
    underlying_metrics: ["water_stress_current"], source_summary: "WRI Aqueduct basin indicators, area-weighted to counties.",
    proxy_caveat: "This does not establish project water rights, withdrawal permits, or guaranteed supply."
  },
  climate: {
    factor_id: "climate", category: "climate", display_name: "Climate Resilience", available: true,
    short_description: "Relative physical climate-risk screening.",
    priority_meaning: "How much should physical climate risk influence the decision?",
    score_meaning: "Higher means more favorable screening-level climate resilience.",
    score_zero_meaning: "Less favorable observed physical climate-risk screening context.",
    score_hundred_meaning: "More favorable observed physical climate-risk screening context.",
    underlying_metrics: ["wildfire_risk_index", "drought_risk_index", "flood_risk_index", "hurricane_risk_index", "extreme_heat_risk_index"],
    source_summary: "FEMA county wildfire, drought, flood, hurricane and extreme-heat indicators.",
    proxy_caveat: "These are relative screening indicators, not probabilities that a disaster will occur."
  },
  infrastructure: {
    factor_id: "infrastructure", category: "infrastructure", display_name: "Infrastructure & Connectivity", available: true,
    short_description: "County broadband connectivity screening context.",
    priority_meaning: "How important are connectivity and infrastructure conditions?",
    score_meaning: "Higher means stronger screening-level infrastructure and connectivity context.",
    score_zero_meaning: "Less favorable observed county connectivity context, not proof of no fiber.",
    score_hundred_meaning: "More favorable observed county connectivity context, not guaranteed site connectivity.",
    underlying_metrics: ["fiber_coverage_pct"], source_summary: "FCC fixed broadband county fiber availability summary. No land-suitability data is integrated.",
    proxy_caveat: "FCC fiber is a mass-market broadband availability proxy, not guaranteed dedicated data-center fiber, backbone capacity, route diversity, SLA, or latency."
  },
  economics: {
    factor_id: "economics", category: "economics", display_name: "Economics", available: true,
    short_description: "Electricity-cost screening context.",
    priority_meaning: "How important is economic attractiveness?",
    score_meaning: "Higher means more favorable economic screening indicators.",
    score_zero_meaning: "Less favorable observed electricity-cost screening context.",
    score_hundred_meaning: "More favorable observed electricity-cost screening context.",
    underlying_metrics: ["industrial_electricity_price_cents_kwh"], source_summary: "EIA state-level industrial electricity prices joined to counties.",
    proxy_caveat: "Electricity price is a state-level industrial proxy, not a negotiated hyperscale tariff."
  },
  community: {
    factor_id: "community", category: "community", display_name: "Workforce & Community Context", available: true,
    short_description: "Census workforce and socioeconomic context, not public opinion.",
    priority_meaning: "How important is workforce and socioeconomic context?",
    score_meaning: "Higher means more favorable workforce and economic context from available Census indicators. The current score uses labor-pool size.",
    score_zero_meaning: "Less favorable observed labor-pool screening context. Zero does not mean community opposition.",
    score_hundred_meaning: "More favorable observed labor-pool screening context, not resident support.",
    underlying_metrics: ["civilian_labor_force"], source_summary: "Census ACS civilian labor force. Other socioeconomic records are context, not approval evidence.",
    proxy_caveat: "This does not measure resident support, community acceptance, or local approval."
  },
  approval: {
    factor_id: "approval", category: "approval", display_name: "Approval Readiness", available: false,
    short_description: "Data unavailable.",
    priority_meaning: "How important is verified local approval readiness? No verified score is currently available.",
    score_meaning: "Data unavailable. No local approval score can be established from the current store.",
    score_zero_meaning: "Not assigned: missing approval evidence is not a zero score.",
    score_hundred_meaning: "Not assigned: no verified approval score is available.",
    underlying_metrics: ["approval_readiness"], source_summary: "No verified local approval dataset is integrated.",
    proxy_caveat: "Local zoning, permitting, utility approvals, and project-specific approvals have not yet been verified."
  }
};

export const factorLabels = Object.fromEntries(categoryKeys.map((factor) => [factor, factorMetadata[factor].display_name])) as Record<CategoryKey, string>;
export function factorForMetric(metric: string): FactorMetadata | undefined {
  return categoryKeys.map((factor) => factorMetadata[factor]).find((metadata) => metadata.underlying_metrics.includes(metric));
}
export function locationScore(factor: CategoryKey, score: number | null | undefined): string {
  return !factorMetadata[factor].available || score == null || !Number.isFinite(score)
    ? "Data unavailable" : `${Number(score.toFixed(1))}/100`;
}
export function changeLabel(field: string, fallback: string): string {
  const factor = field.startsWith("weights.") ? field.slice(8) as CategoryKey : undefined;
  return factor && factorMetadata[factor] ? `${factorMetadata[factor].display_name} normalized weight` : fallback;
}

export const capacityHelp = "Capacity is a project requirement, not a preference. It screens whether a location warrants further power and infrastructure diligence. Public datasets do not prove that the requested MW is actually available at a specific site.";
export const goLiveHelp = "Go-live year is current project context, not a future forecast. Scenario analysis is not enabled in the current system.";
