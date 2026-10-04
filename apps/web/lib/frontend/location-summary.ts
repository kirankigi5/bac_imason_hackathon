import { factorLabels } from "./factor-metadata";
import type { CategoryKey, DecisionTrace, FeasibilityCheck, ProjectState } from "@/lib/types/domain";

export const screeningLabels = factorLabels;
export const metricLabels: Record<string, string> = {
  water_stress_current: "Water stress", fiber_coverage_pct: "Fiber coverage",
  grid_carbon_intensity_kgco2e_mwh: "Grid carbon", noncombustion_generation_pct: "Clean generation",
  annual_mean_temperature_c: "Temperature", industrial_electricity_price_cents_kwh: "Electricity price",
  wildfire_risk_index: "Wildfire risk", drought_risk_index: "Drought risk", flood_risk_index: "Flood risk",
  hurricane_risk_index: "Hurricane risk", extreme_heat_risk_index: "Heat risk",
  approval_readiness: "Approval readiness", civilian_labor_force: "Workforce context",
  grid_readiness_score: "Grid-readiness proxy", state_code: "Geography", category_scores: "Active priorities"
};
export function checkLabel(check: FeasibilityCheck): string {
  const category = check.metric.startsWith("category_scores.") ? check.metric.slice(16) as CategoryKey : undefined;
  return metricLabels[check.metric.replace(/^raw_metrics\./, "")] ?? (category && screeningLabels[category])
    ?? (check.factor === "capacity" ? "Capacity proxy" : check.factor === "geography" ? "Geography"
      : check.factor === "priorities" ? "Active priorities" : screeningLabels[check.factor]);
}

export function buildLocationSummary(trace: DecisionTrace, project: ProjectState) {
  const strengths = trace.positive_drivers.filter((row) => row.contribution > 0 && row.score > 0).slice(0, 3)
    .map((row) => ({ factor: row.factor, label: screeningLabels[row.factor], score: row.score, metric_type: row.metric_type }));
  const risks: Array<{ id: string; text: string }> = [];
  for (const check of trace.feasibility.checks.filter((row) => row.status === "FAIL" || row.required && row.status === "UNKNOWN")) {
    const text = check.status === "FAIL" ? `${checkLabel(check)} requirement failed` : `${checkLabel(check)} required evidence missing`;
    if (!risks.some((risk) => risk.text === text)) risks.push({ id: check.id, text });
  }
  const missing = new Set(trace.major_missing_evidence);
  if (missing.has("site_power_capacity")) risks.push({ id: "site-power", text: `${project.capacityMw ? `${project.capacityMw} MW site` : "Site"} power availability is not verified` });
  const siteRisks = [
    ["local_approval", "Local approval is not documented"],
    ["dedicated_fiber_capacity", "Dedicated data-center fiber requires validation"],
    ["utility_interconnection_approval", "Utility interconnection is not verified"],
    ["parcel_suitability", "Parcel suitability is not evaluated"],
    ["negotiated_data_center_tariff", "Negotiated tariff is unavailable"],
    ["community_acceptance", "Community acceptance is not established"]
  ];
  for (const [id, text] of siteRisks) if (missing.has(id)) risks.push({ id, text });
  for (const row of trace.negative_drivers) risks.push({ id: "weak:" + row.factor, text: `${screeningLabels[row.factor]} is weaker (${row.score.toFixed(1)}/100)` });
  for (const metric of trace.missing_metrics) risks.push({ id: "missing:" + metric, text: `${metricLabels[metric] ?? "Screening metric"} evidence is missing` });
  for (const check of trace.feasibility.checks.filter((row) => row.status === "DILIGENCE_REQUIRED")) {
    if (check.factor !== "capacity" || !missing.has("site_power_capacity")) risks.push({ id: check.id, text: `${checkLabel(check)} requires diligence` });
  }
  if (trace.metrics.some((row) => row.status === "stale")) risks.push({ id: "stale", text: "Stale source evidence needs refresh" });
  return { strengths, risks: risks.slice(0, 3), allRisks: risks };
}
