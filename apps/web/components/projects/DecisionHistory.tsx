"use client";

import { RefreshCw } from "lucide-react";
import { useAPIResource } from "@/lib/frontend/use-api-resource";
import type { ProjectHistory, SavedProject } from "@/lib/frontend/contracts";
import { displayValue } from "@/components/location/MetricDetails";

function changeValue(field: string, value: unknown) {
  return field.startsWith("weights.") && typeof value === "number" ? `${(value * 100).toFixed(2)}%` : displayValue(value);
}
export function DecisionHistory({ saved, countyName }: { saved?: SavedProject; countyName: (id: string) => string }) {
  const resource = useAPIResource<ProjectHistory>(`/api/projects/${saved?.id}/history?revision=${saved?.revision}`, undefined, !!saved);
  if (!saved) return <p className="empty-state">No saved project history.</p>;
  return <div>
    <div className="panel-heading"><h3>Decision History</h3><button className="icon-button" aria-label="Refresh history" title="Refresh history" onClick={resource.retry}><RefreshCw size={16} /></button></div>
    {resource.loading ? <p role="status">Loading accepted changes...</p> : null}
    {resource.error ? <p role="alert">{resource.error}</p> : null}
    {resource.data ? <>
      <p className="mb-3 text-xs text-steel">Local integrity check: {resource.data.integrity.valid ? "passed" : "failed"}. {resource.data.integrity.scope}</p>
      <ol className="history-list">{[...resource.data.events].reverse().map((event) => {
        const effects = event.ranking_effect_summary as { top_1_before?: string | null; top_1_after?: string | null; newly_excluded_count?: number; newly_feasible_count?: number; baseline?: string };
        return <li key={event.id} data-history-revision={event.revision}>
          <div className="flex flex-wrap justify-between gap-2 text-xs text-steel"><time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleString()}</time><span>Revision {event.revision} / {event.source}</span></div>
          {event.user_message ? <p className="mt-2 text-sm font-semibold text-ink">{event.user_message}</p> : null}
          <dl className="mt-2 space-y-2 text-sm">{event.interpreted_change.map((change, index) => <div key={index}>
            <dt className="break-words font-semibold text-ink">{change.field}</dt><dd className="break-words text-steel">{changeValue(change.field, change.old_value)} &rarr; {changeValue(change.field, change.new_value)}</dd>
          </div>)}</dl>
          {effects.top_1_after || effects.top_1_before ? <p className="mt-3 text-sm text-steel">Winner: {effects.top_1_before ? countyName(effects.top_1_before) : "None"} &rarr; {effects.top_1_after ? countyName(effects.top_1_after) : "None"}</p> : null}
          {effects.newly_excluded_count !== undefined ? <p className="text-xs text-steel">{effects.newly_excluded_count} newly excluded / {effects.newly_feasible_count ?? 0} newly eligible</p> : null}
          <details className="mt-2 text-xs text-steel"><summary>Evaluation versions</summary><p className="mt-2 break-all">{event.versions.data_release_id} / {event.versions.scoring_version} / {event.versions.normalization_version}</p><p>{effects.baseline}</p></details>
        </li>;
      })}</ol>
    </> : null}
  </div>;
}
