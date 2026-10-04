import type { EvidenceItem, MetricQuality, LocationFeature, RankedLocation } from "@/lib/types/domain";

export const majorMissingEvidence = ["site_power_capacity", "utility_interconnection_approval", "dedicated_fiber_capacity",
  "negotiated_data_center_tariff", "parcel_suitability", "local_approval", "community_acceptance"];

export function metricQuality(item: EvidenceItem): MetricQuality {
  const type = item.raw_value === null ? "missing" : item.status === "estimated" ? "estimated"
    : /workforce|civilian_labor_force|risk|stress|temperature|price|carbon|generation|coverage|approval/.test(item.metric_name)
      || item.geographic_scope?.includes("proxy") ? "proxy" : item.source_name.includes("Census") ? "estimated" : "measured";
  return { metric: item.metric_name, evidence_id: `${item.location_id}:${item.metric_name}:${item.raw_sha256 ?? "missing"}`,
    value: item.raw_value, score: item.normalized_value, unit: item.unit,
    source: item.source_name, source_url: item.source_url, source_year: item.source_year,
    ...(item.source_as_of ? { source_as_of: item.source_as_of } : {}),
    metric_type: type, status: item.status, raw_sha256: item.raw_sha256,
    confidence: type === "missing" ? "MISSING" : item.status === "stale" ? "STALE_SOURCE"
      : item.status === "estimated" ? "DEMO_ESTIMATE" : type === "proxy" ? "OFFICIAL_SCREENING_PROXY"
        : type === "estimated" ? "OFFICIAL_ESTIMATE" : "OFFICIAL_MEASUREMENT",
    caveat: item.notes || "Source evidence describes this indicator; county-level screening is not site feasibility." };
}

export function rankingQuality(location: LocationFeature): Pick<RankedLocation, "available_ranking_metrics" | "missing_ranking_metrics" | "major_missing_evidence" | "confidence_label"> {
  const metrics = location.normalized_metrics ?? location.category_scores;
  const available = Object.values(metrics).filter((value) => value !== null).length;
  const missing = Object.values(metrics).length - available;
  const confidence = location.data_status === "estimated" ? "DEMO_ESTIMATE" : available === 0 ? "INSUFFICIENT_DATA"
    : location.data_status === "stale" || location.data_completeness_score < 80 ? "LIMITED_SCREENING_DATA" : "SCREENING_ONLY";
  return { available_ranking_metrics: available, missing_ranking_metrics: missing,
    major_missing_evidence: [...majorMissingEvidence], confidence_label: confidence };
}
