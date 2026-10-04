import { categoryKeys, type Constraint, type FeasibilityCheck, type FeasibilityResult, type LocationFeature, type ProjectState } from "@/lib/types/domain";

export function evaluateFeasibility(project: ProjectState, location: LocationFeature): FeasibilityResult {
  const failed: string[] = [];
  const warnings: string[] = [];
  const checks: FeasibilityCheck[] = [];

  if (project.geography?.states?.length && !project.geography.states.includes(location.state_code)) {
    failed.push(`Outside selected states (${project.geography.states.join(", ")})`);
  }
  if (project.geography?.states?.length) checks.push({ id: "geography", factor: "geography", label: "Selected geography",
    metric: "state_code", status: project.geography.states.includes(location.state_code) ? "PASS" : "FAIL",
    value: location.state_code, threshold: project.geography.states.join(","), required: true });

  if (project.capacityMw) {
    const requiredGridScore = project.capacityMw >= 700 ? 70 : project.capacityMw >= 500 ? 60 : 50;
    if (location.grid_readiness_score !== null && location.grid_readiness_score < requiredGridScore) {
      failed.push(`Grid readiness proxy ${location.grid_readiness_score}/100 is below the ${requiredGridScore}/100 gate for ${project.capacityMw} MW.`);
    }
    checks.push({ id: "capacity-grid-proxy", factor: "capacity", label: `Grid-readiness proxy gate for requested ${project.capacityMw} MW; not actual available MW`,
      metric: "grid_readiness_score", value: location.grid_readiness_score, threshold: requiredGridScore, operator: ">=",
      required: false, status: location.grid_readiness_score === null ? "DILIGENCE_REQUIRED" : location.grid_readiness_score < requiredGridScore ? "FAIL" : "PASS" });
    warnings.push(location.grid_readiness_score === null
      ? "Power readiness is unavailable; capacity feasibility requires utility/interconnection validation."
      : "Grid readiness is a public-data proxy, not a guarantee of available interconnection capacity.");
  }

  for (const constraint of project.constraints) {
    const value = getMetricValue(location, constraint.metric);
    const known = value !== null && value !== undefined;
    const factor = constraint.metric.includes("fiber") ? "infrastructure" : constraint.metric.includes("carbon") ? "energy"
      : constraint.metric.includes("water") ? "water" : constraint.metric.includes("grid") ? "infrastructure" : "climate";
    checks.push({ id: constraint.id, factor, label: constraint.label, metric: constraint.metric,
      status: !known ? "UNKNOWN" : passesConstraint(location, constraint) ? "PASS" : "FAIL",
      value: value ?? null, threshold: constraint.value, operator: constraint.operator, required: true });
    if (!passesConstraint(location, constraint)) {
      failed.push(value === null || value === undefined ? `${constraint.label}: required evidence is unavailable` : constraint.label);
    }
  }

  if (location.data_status === "estimated") {
    warnings.push("This candidate uses estimated seeded demo data; replace with official datasets before real decisions.");
  }
  if (location.data_status === "stale") warnings.push("One or more source refreshes failed; last-known-good measurements are being used.");
  const missingCategories = categoryKeys.filter((key) => location.category_scores[key] === null);
  const observedFailure = checks.some((check) => check.status === "FAIL");
  const unknownRequired = checks.some((check) => check.required && check.status === "UNKNOWN");
  const conditional = !!project.capacityMw || missingCategories.length > 0 || location.data_status === "stale" || location.data_status === "estimated";
  const status = observedFailure ? "INFEASIBLE" : unknownRequired ? "INSUFFICIENT_DATA" : conditional ? "CONDITIONALLY_FEASIBLE" : "FEASIBLE";
  const reasons = failed.length ? [...failed] : conditional
    ? [...warnings, ...(missingCategories.length ? ["Missing screening categories: " + missingCategories.join(", ") + "; site-level diligence remains required."] : [])]
    : ["All observed county-screening requirements pass; this status does not establish parcel suitability or site approval."];

  return {
    is_feasible: failed.length === 0,
    status, reasons, checks,
    failed_constraints: failed,
    warnings
  };
}

export function getMetricValue(location: LocationFeature, metric: string): number | string | null | undefined {
  if (metric.startsWith("category_scores.")) {
    const key = metric.replace("category_scores.", "");
    return location.category_scores[key as keyof typeof location.category_scores];
  }
  if (metric.startsWith("raw_metrics.")) {
    const key = metric.replace("raw_metrics.", "");
    return location.raw_metrics[key];
  }
  return location[metric as keyof LocationFeature] as number | string | undefined;
}

function passesConstraint(location: LocationFeature, constraint: Constraint): boolean {
  const raw = getMetricValue(location, constraint.metric);
  if (raw === undefined || raw === null) return false;

  if (typeof constraint.value === "number") {
    const value = Number(raw);
    if (!Number.isFinite(value)) return false;
    switch (constraint.operator) {
      case "<":
        return value < constraint.value;
      case "<=":
        return value <= constraint.value;
      case ">":
        return value > constraint.value;
      case ">=":
        return value >= constraint.value;
      case "=":
        return value === constraint.value;
    }
  }

  return String(raw).toLowerCase() === String(constraint.value).toLowerCase();
}
