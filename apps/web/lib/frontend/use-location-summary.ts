"use client";

import { useEffect, useState } from "react";
import { requestJSON } from "./api";
import { buildSummaryFacts, renderSummary } from "@/lib/llm/location-summary";
import type { Audience, DecisionTrace, ProjectState, ProviderStatus } from "@/lib/types/domain";

type Result = { summary: string; provider: ProviderStatus };
const cache = new Map<string, { expires: number; result: Result }>();
const pending = new Map<string, Promise<Result>>();
export function clearLocationSummaryResources() { cache.clear(); pending.clear(); }

export function useLocationSummary(trace: DecisionTrace | undefined, project: ProjectState, audience: Audience, name: string, state: string, revision?: number, enabled = true) {
  const key = trace && enabled ? JSON.stringify([trace.location_id, trace.project_hash, revision, audience, trace.rank,
    trace.overall_score, trace.data_release_id, trace.scoring_version, trace.normalization_version]) : undefined;
  const fallback = trace ? renderSummary(buildSummaryFacts(trace, project, name, state), audience) : undefined;
  const [current, setCurrent] = useState<{ key: string; result: Result }>();
  useEffect(() => {
    if (!key || !trace) return;
    let active = true;
    const previous = cache.get(key);
    if (previous && previous.expires > Date.now()) { setCurrent({ key, result: previous.result }); return; }
    let work = pending.get(key);
    if (!work) {
      work = requestJSON<Result>(`/api/locations/${trace.location_id}/summary`, { project, audience, revision }).then((result) => {
        if (typeof result.summary !== "string" || result.summary.trim().split(/\s+/).length > 80 || result.summary.trim().split(/\s+/).length < 50) throw new Error("Invalid concise summary");
        if (cache.size >= 128) cache.delete(cache.keys().next().value!);
        cache.set(key, { result, expires: Date.now() + (result.provider?.mode === "llm" ? 30 * 60_000 : 30_000) });
        return result;
      }).finally(() => pending.delete(key));
      pending.set(key, work);
    }
    work.then((result) => { if (active) setCurrent({ key, result }); }).catch(() => {
      if (active) setCurrent({ key, result: { summary: "", provider: { provider: "local", mode: "fallback" } } });
    });
    return () => { active = false; };
  }, [key]);
  return { text: current && current.key === key ? current.result.summary || fallback : fallback, loading: !!key && current?.key !== key,
    provider: current && current.key === key ? current.result.provider : undefined };
}
