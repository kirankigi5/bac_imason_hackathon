import { factorLabels } from "@/lib/frontend/factor-metadata";
import { categoryKeys, type Audience, type ExplanationPayload } from "@/lib/types/domain";
import { contributionMetricNames } from "./explanations";

export type ExplanationFact = { id: string; text: string; kind: "recommendation" | "trade_off" | "risk" | "evidence" | "uncertainty" | "change"; required?: boolean };

export function explanationFacts(payload: ExplanationPayload): ExplanationFact[] {
  const { location } = payload;
  const facts: ExplanationFact[] = [{ id: "recommendation", kind: "recommendation", required: true,
    text: location.feasibility.is_feasible
      ? `${location.county_name}, ${location.state_code} ranks #${location.rank} with ${location.overall_score}/100 under the current project weights.`
      : `${location.county_name}, ${location.state_code} is excluded by the current feasibility constraints; its unqualified score is ${location.overall_score}/100, not a recommendation.` }];
  facts.push({ id: "project", kind: "recommendation", required: true,
    text: `The requested project is ${payload.project.capacityMw ?? "unspecified"} MW, ${payload.project.workloadType ?? "unspecified workload"}, targeting go-live in ${payload.project.targetGoLiveYear ?? "an unspecified year"}. These are requested parameters, not verified construction or power availability. Planning horizon ${payload.project.planningHorizonYear ?? "is unspecified"} is context only, not a scenario forecast.` });
  facts.push({ id: "feasibility-status", kind: "uncertainty", required: true,
    text: `County-screening status is ${location.feasibility.status}. ${location.feasibility.reasons.join(" ")} This is not a finding of utility approval or parcel suitability.` });
  if (payload.versions) facts.push({ id: "ranking-versions", kind: "evidence", required: true,
    text: `Data release ${payload.versions.data_release_id}; scoring ${payload.versions.scoring_version}; normalization ${payload.versions.normalization_version}.` });
  for (const factor of categoryKeys) {
    const score = location.category_scores[factor];
    facts.push({ id: "factor:" + factor, kind: score === null ? "uncertainty" : "trade_off",
      text: score === null ? `${factorLabels[factor]} is unavailable and excluded from scoring.`
        : `${factorLabels[factor]} scores ${score}/100, contributes ${location.weighted_contributions[factor]} points, and receives ${(location.normalized_weights[factor] * 100).toFixed(1)}% of the available-metric weight.` });
  }
  for (const [index, record] of payload.evidence.entries()) {
    if (record.raw_value === null) continue;
    facts.push({ id: "evidence:" + index, kind: "evidence",
      text: `${record.metric_name}: ${record.raw_value} ${record.unit}; ${record.source_name} (${record.source_as_of ?? record.source_year}); ${payload.metricTypes?.[record.metric_name] ?? "proxy"}; ${record.geographic_scope ?? "county"}. ${record.notes}` });
  }
  for (const [index, risk] of [...location.risks, ...location.feasibility.failed_constraints].entries()) {
    facts.push({ id: "risk:" + index, kind: "risk", text: risk + "." });
  }
  for (const [index, constraint] of (payload.passedConstraints ?? []).entries()) {
    facts.push({ id: "passed:" + index, kind: "evidence", text: "Passes the observed constraint: " + constraint.label + "." });
  }
  facts.push({ id: "completeness", kind: "uncertainty", required: true,
    text: `Data completeness is ${location.data_completeness_score}% of configured metrics, not prediction confidence. Missing metrics are excluded and available weights renormalized.` });
  for (const [index, caveat] of payload.caveats.entries()) {
    facts.push({ id: "caveat:" + index, kind: "uncertainty", required: true, text: caveat });
  }
  const fiberRecord = payload.evidence.find((item) => item.metric_name === "fiber_coverage_pct");
  const missingFiber = fiberRecord?.raw_value == null;
  if (missingFiber) facts.push({ id: "missing:fiber", kind: "uncertainty", required: true,
    text: "FCC fiber coverage is unavailable; no fiber score or backbone-capacity evidence is established."
      + (fiberRecord?.source_as_of ? ` FCC vintage ${fiberRecord.source_as_of}: ${fiberRecord.notes}` : "") });
  else facts.push({ id: "proxy:fiber", kind: "uncertainty", required: true,
    text: "FCC fiber coverage is a county-unit mass-market business availability proxy at 100/20 Mbps, not dedicated data-center connectivity, backbone capacity, route diversity or an SLA." });
  facts.push({ id: "site-limitations", kind: "uncertainty", required: true,
    text: "Real site power capacity, negotiated tariffs, land suitability, local approval, community acceptance and job creation are unavailable unless independently documented; none is established by this ranking." });

  const alternative = payload.comparison ?? payload.nearestAlternatives[0];
  if (alternative) {
    const gap = Number((location.overall_score - alternative.overall_score).toFixed(1));
    facts.push({ id: "comparison", kind: "trade_off",
      text: `${alternative.county_name}, ${alternative.state_code} ranks ${alternative.rank ? "#" + alternative.rank : "as excluded"} with ${alternative.overall_score}/100. ${location.county_name} ${gap >= 0 ? "leads" : "trails"} by ${Math.abs(gap).toFixed(1)} points under the current weights.` });
    for (const factor of categoryKeys) {
      if (location.category_scores[factor] === null || alternative.category_scores[factor] === null) continue;
      const difference = Number((alternative.weighted_contributions[factor] - location.weighted_contributions[factor]).toFixed(2));
      facts.push({ id: "comparison:" + factor, kind: "trade_off",
        text: `${factorLabels[factor]} contributes ${alternative.weighted_contributions[factor]} points to ${alternative.county_name} versus ${location.weighted_contributions[factor]} to ${location.county_name}; the alternative's contribution difference is ${difference} points.` });
    }
    if (payload.question === "outrank") facts.push({ id: "outrank", kind: "trade_off", required: true,
      text: `${alternative.county_name} would outrank ${location.county_name} only if it passes the constraints and its recomputed total weighted score becomes higher. Its current score gap is ${Number((alternative.overall_score - location.overall_score).toFixed(1))} points. A weight change requires deterministic reranking; this is not a prediction of approval or site capacity.` });
  }
  if (!alternative && (payload.question === "why_not_second" || payload.question === "outrank")) facts.push({
    id: "comparison:missing", kind: "uncertainty", required: true,
    text: "No qualifying comparison county is available in this payload; a second-place or outranking claim cannot be established." });
  if (payload.rankingChange) {
    facts.push({ id: "change:summary", kind: "change", required: true,
      text: `The same feature release was evaluated before and after the project update: ${payload.rankingChange.newlyExcludedCount} counties newly excluded and ${payload.rankingChange.newlyFeasibleCount} newly feasible.` });
    for (const change of payload.rankingChange.changes) facts.push({ id: "change:parameter:" + change.field + ":" + facts.length,
      kind: "change", text: `${change.changeType}: ${change.label} changed from ${change.oldValue ?? "unset"} to ${change.newValue ?? "removed"}.` });
    for (const row of payload.rankingChange.locations) {
      facts.push({ id: "change:county:" + row.locationId, kind: "change",
        text: `${row.countyName}: rank ${row.oldRank ?? "excluded"} to ${row.newRank ?? "excluded"}; score ${row.oldScore} to ${row.newScore}.` });
      for (const factor of row.factors.filter((item) => item.difference !== 0 || item.oldWeight !== item.newWeight)) {
        facts.push({ id: "change:factor:" + row.locationId + ":" + factor.factor, kind: "change",
          text: `${row.countyName}, ${factorLabels[factor.factor]}: effective weight ${(100 * factor.oldWeight).toFixed(1)}% to ${(100 * factor.newWeight).toFixed(1)}%; contribution ${factor.oldContribution} to ${factor.newContribution} points (${factor.difference >= 0 ? "+" : ""}${factor.difference}).` });
      }
      if (row.newlyFailedConstraints.length) facts.push({ id: "change:failed:" + row.locationId, kind: "change",
        text: `${row.countyName} newly fails: ${row.newlyFailedConstraints.join("; ")}.` });
      if (row.newlyPassedConstraints.length) facts.push({ id: "change:passed:" + row.locationId, kind: "change",
        text: `${row.countyName} no longer fails: ${row.newlyPassedConstraints.join("; ")}.` });
    }
  } else if (payload.question === "ranking_change") facts.push({ id: "change:missing", kind: "uncertainty", required: true,
    text: "No previous complete project profile is available to compute a ranking change; no before/after cause is inferred." });
  return facts;
}

const introductions: Record<Audience, string> = {
  developer: "Developer review: power, economics, infrastructure, schedule and site risk require source-specific validation.",
  government: "Government review: infrastructure, economic context, water/power impacts, mitigation and approval caveats.",
  community: "Community review: water, electricity, land, environmental impacts, jobs, uncertainty and mitigation. Workforce context is not a jobs forecast or resident support."
};

export function renderFacts(facts: ExplanationFact[], selectedIds: string[], audience: Audience): string {
  const known = new Set(facts.map((fact) => fact.id));
  if (selectedIds.some((id) => !known.has(id))) throw new Error("Explanation cites unsupported facts");
  const ids = [...new Set([...selectedIds, ...facts.filter((fact) => fact.required).map((fact) => fact.id)])];
  return introductions[audience] + "\n\n" + ids.map((id) => facts.find((fact) => fact.id === id)!.text).join("\n\n");
}

export function selectLocalFacts(payload: ExplanationPayload, facts: ExplanationFact[], audience: Audience = "developer"): string[] {
  const leaders = payload.topPositiveContributions.map((item) => "factor:" + item.factor);
  const question = payload.question ?? "why_here";
  const focused = question === "ranking_change" ? facts.filter((fact) => fact.kind === "change")
    : question === "risks" ? facts.filter((fact) => fact.kind === "risk" || fact.kind === "uncertainty")
    : question === "why_not_second" || question === "outrank" ? facts.filter((fact) => fact.id.startsWith("comparison") || fact.id === "outrank") : [];
  const evidence = payload.topPositiveContributions.flatMap((driver) => {
    const index = payload.evidence.findIndex((item) => item.raw_value !== null && contributionMetricNames[driver.factor].includes(item.metric_name));
    return index < 0 ? [] : ["evidence:" + index];
  });
  const audienceFactors = audience === "community" ? ["water", "energy", "community"]
    : audience === "government" ? ["infrastructure", "water", "economics", "approval"] : ["energy", "economics", "infrastructure", "climate"];
  return ["recommendation", ...audienceFactors.map((factor) => "factor:" + factor), ...leaders,
    ...focused.slice(0, 14).map((fact) => fact.id), ...evidence];
}
