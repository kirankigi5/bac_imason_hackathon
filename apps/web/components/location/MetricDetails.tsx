import { ExternalLink } from "lucide-react";
import type { EvidenceItem, MetricQuality } from "@/lib/types/domain";
import { factorForMetric } from "@/lib/frontend/factor-metadata";
import { FactorHelp } from "@/components/scoring/FactorHelp";

export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "Missing";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
export const metricLabel = (value: string) => value.replaceAll("_", " ");

export function MetricDetails({ metric, evidence }: { metric: MetricQuality; evidence?: EvidenceItem }) {
  const factor = factorForMetric(metric.metric);
  return <div className="metric-details" data-evidence-id={metric.evidence_id}>
    <dl className="data-grid">
      <div><dt>Raw value</dt><dd data-raw-value={metric.value === null ? "missing" : String(metric.value)}>{displayValue(metric.value)}{metric.value === null ? "" : ` ${metric.unit}`}</dd></div>
      <div><dt>Normalized score</dt><dd>{metric.score == null ? "Data unavailable" : `${metric.score}/100`}</dd></div>
      <div><dt>Type / status</dt><dd className="capitalize">{metric.metric_type} / {metric.status}</dd></div>
      <div><dt>Evidence quality</dt><dd>{metricLabel(metric.confidence)}</dd></div>
      <div><dt>Source</dt><dd>{metric.source || "Unavailable"}</dd></div>
      <div><dt>Year / as of</dt><dd>{metric.source_as_of ?? displayValue(metric.source_year)}</dd></div>
    </dl>
    {factor ? <div className="evidence-factor-help">{factor.display_name}<FactorHelp factor={factor.factor_id} /></div> : null}
    <p className="mt-3 text-xs leading-5 text-steel">{metric.caveat}</p>
    {/^https:\/\//.test(metric.source_url) ? <a className="source-link" href={metric.source_url} target="_blank" rel="noreferrer"><ExternalLink size={13} />Official source</a> : null}
    {evidence ? <dl className="mt-3 space-y-2 text-xs text-steel">
      {evidence.transformation_method && evidence.transformation_method !== metric.caveat ? <div><dt className="font-semibold">Methodology</dt><dd>
        <details><summary>Transformation</summary><p>{evidence.transformation_method}</p></details>
      </dd></div> : null}
      {evidence.raw_artifact_name ? <div><dt className="font-semibold">Raw artifact</dt><dd className="break-all">{evidence.raw_artifact_name}</dd></div> : null}
      {evidence.source_export_date ? <div><dt className="font-semibold">Export date</dt><dd>{evidence.source_export_date}</dd></div> : null}
    </dl> : null}
    {metric.raw_sha256 ? <details className="mt-2 text-xs text-steel"><summary>Artifact SHA-256</summary><code className="block break-all py-2">{metric.raw_sha256}</code></details> : null}
    {evidence ? <details className="mt-3 text-xs text-steel"><summary>Full evidence record</summary>
      <pre className="whitespace-pre-wrap break-all py-2" data-original-evidence={metric.evidence_id}>{JSON.stringify(evidence, null, 2)}</pre>
    </details> : null}
  </div>;
}
