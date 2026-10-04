import type { Audience, DecisionTrace } from "@/lib/types/domain";
import { stableHash } from "@/lib/backend/cache";
import { llmCredentials } from "./health";
import type { ProviderResult } from "./provider";

export function summaryCacheKey(trace: DecisionTrace, audience: Audience, revision?: number) {
  return stableHash({ county: trace.location_id, project: trace.project_hash, revision, audience,
    rank: trace.rank, score: trace.overall_score, release: trace.data_release_id, scoring: trace.scoring_version,
    normalization: trace.normalization_version, provider: process.env.LLM_PROVIDER, model: process.env.LLM_MODEL,
    credential: llmCredentials() });
}
export class SummaryCache {
  private entries = new Map<string, { expires: number; result: ProviderResult<string> }>();
  private pending = new Map<string, Promise<ProviderResult<string>>>();
  constructor(private limit = 128, private now = () => Date.now()) {}
  async get(key: string, generate: () => Promise<ProviderResult<string>>) {
    const saved = this.entries.get(key);
    if (saved && saved.expires > this.now()) {
      this.entries.delete(key); this.entries.set(key, saved); return structuredClone(saved.result);
    }
    if (this.pending.has(key)) return structuredClone(await this.pending.get(key)!);
    const work = generate(); this.pending.set(key, work);
    try {
      const result = await work;
      this.entries.delete(key);
      while (this.entries.size >= this.limit) this.entries.delete(this.entries.keys().next().value!);
      this.entries.set(key, { result: structuredClone(result), expires: this.now() + (result.status.mode === "llm" ? 30 * 60_000 : 30_000) });
      return structuredClone(result);
    } finally { this.pending.delete(key); }
  }
  clear() { this.entries.clear(); this.pending.clear(); }
}
export const locationSummaryCache = new SummaryCache();
