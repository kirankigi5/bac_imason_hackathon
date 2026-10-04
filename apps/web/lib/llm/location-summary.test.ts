import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decisionTrace } from "@/lib/decision-engine/decision-trace";
import { cloneProject } from "@/lib/project/defaults";
import { buildSummaryFacts, renderSummary, summarySentences } from "./location-summary";
import { LocalDeterministicProvider, StructuredLLMProvider } from "./provider";
import { resetLLMHealth } from "./health";
import { SummaryCache, summaryCacheKey } from "./summary-cache";
import type { Audience, DecisionTrace } from "@/lib/types/domain";

const project = cloneProject({ capacityMw: 500, workloadType: "AI_TRAINING", targetGoLiveYear: 2030, activePrioritySignals: ["energy", "water"] });
const trace = decisionTrace(project, "county-46021");
const facts = buildSummaryFacts(trace, project, "Campbell County", "SD");
const ids = ["intro:alternative", "status:observed", "diligence:audience"];
beforeEach(() => resetLLMHealth());
afterEach(() => { vi.unstubAllEnvs(); resetLLMHealth(); });
describe("grounded main LLM summary", () => {
  it.each(["developer", "government", "community"] as const)("calls the model with compact facts and validates %s sentence selection", async (audience) => {
    const before = JSON.stringify({ trace, project }), complete = vi.fn().mockResolvedValue({ sentence_ids: ids });
    const result = await new StructuredLLMProvider({ complete }, "test-model").generateLocationSummary(facts, audience);
    expect(complete).toHaveBeenCalledTimes(1); expect(result.status).toMatchObject({ mode: "llm", provider: "test-model" });
    expect(result.value).toBe(renderSummary(facts, audience, ids));
    const input = complete.mock.calls[0][1];
    expect(input).toEqual({ audience, facts, sentences: summarySentences(facts, audience) });
    expect(input.facts.rank).toBe(trace.rank); expect(input.facts.screening_score).toBe(trace.overall_score); expect(input.facts.feasibility).toBe(trace.feasibility.status);
    expect(JSON.stringify(input)).not.toMatch(/county-\d{5}|raw_sha256|normalization_version|scoring_version|data_release_id|EPSG|source_url|transformation_method/);
    expect(result.value.split(/\s+/).length).toBeGreaterThanOrEqual(50); expect(result.value.split(/\s+/).length).toBeLessThanOrEqual(80);
    expect(result.value).not.toMatch(/guaranteed|residents support|site approved|available 500 MW/);
    expect(JSON.stringify({ trace, project })).toBe(before);
  });
  it.each([
    null, {}, { sentence_ids: ["intro:direct"] },
    { sentence_ids: ["intro:direct", "status:approved", "diligence:direct"] },
    { sentence_ids: ["intro:direct", "status:observed", "diligence:invented"] },
    { sentence_ids: ["diligence:direct", "status:observed", "intro:direct"] },
    { sentence_ids: ["intro:direct", "status:observed", "diligence:direct"], explanation: "500 MW guaranteed; all permits approved." }
  ])("rejects malformed or fabricated model claims and returns complete fallback %#", async (output) => {
    const result = await new StructuredLLMProvider({ complete: vi.fn().mockResolvedValue(output) }).generateLocationSummary(facts, "developer");
    expect(result.status.mode).toBe("fallback"); expect(result.value).toBe(renderSummary(facts, "developer"));
    expect(result.value).toContain("not verified"); expect(result.value.split(/\s+/).length).toBeLessThanOrEqual(80);
  });
  it("falls back after provider request failure and also works when disabled", async () => {
    const result = await new StructuredLLMProvider({ complete: vi.fn().mockRejectedValue(new Error("unavailable")) }).generateLocationSummary(facts, "community");
    expect(result.status.mode).toBe("fallback"); expect(result.value).toBe((await new LocalDeterministicProvider().generateLocationSummary(facts, "community")).value);
  });
  it("cannot transform an excluded county into a recommendation", async () => {
    const current = cloneProject({ ...project, constraints: [{ id: "water-limit", label: "Water limit", metric: "raw_metrics.water_stress_current", operator: "<", value: -1, kind: "hard" }] });
    const excluded = decisionTrace(current, "county-46021"), input = buildSummaryFacts(excluded, current, "Campbell County", "SD");
    const result = await new StructuredLLMProvider({ complete: vi.fn().mockResolvedValue({ sentence_ids: ids }) }).generateLocationSummary(input, "government");
    expect(excluded.feasibility.status).toBe("INFEASIBLE"); expect(result.value).toContain("does not qualify"); expect(result.value).toContain("requirement failed");
  });
  it("rejects a selection whose rendered output exceeds the length cap", () => {
    const input = { ...facts, county: { ...facts.county, name: "An excessively long county name ".repeat(25) } };
    expect(() => renderSummary(input, "developer", ids)).toThrow("Summary length");
  });
});
describe("summary cache and invalidation", () => {
  it("deduplicates concurrent requests and reuses an isolated cached result", async () => {
    const cache = new SummaryCache(); let resolve!: (value: { value: string; status: { provider: string; mode: "llm" } }) => void;
    const generate = vi.fn(() => new Promise<{ value: string; status: { provider: string; mode: "llm" } }>((done) => { resolve = done; }));
    const first = cache.get("county/revision/audience", generate), second = cache.get("county/revision/audience", generate);
    expect(generate).toHaveBeenCalledTimes(1); resolve({ value: "Grounded summary", status: { provider: "test", mode: "llm" } });
    const one = await first, two = await second; one.value = "changed";
    expect(two.value).toBe("Grounded summary"); expect((await cache.get("county/revision/audience", generate)).value).toBe("Grounded summary");
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it.each(["location_id", "project_hash", "rank", "overall_score", "data_release_id", "scoring_version", "normalization_version"] as const)("invalidates for changed %s", (field) => {
    const different: DecisionTrace = structuredClone(trace);
    Object.assign(different, { [field]: typeof trace[field] === "number" ? Number(trace[field]) + 1 : "changed" });
    expect(summaryCacheKey(different, "developer", 1)).not.toBe(summaryCacheKey(trace, "developer", 1));
  });
  it("invalidates for revision, audience and provider configuration changes", () => {
    const key = summaryCacheKey(trace, "developer", 1);
    expect(summaryCacheKey(trace, "developer", 2)).not.toBe(key); expect(summaryCacheKey(trace, "community", 1)).not.toBe(key);
    vi.stubEnv("LLM_MODEL", "different-model"); expect(summaryCacheKey(trace, "developer", 1)).not.toBe(key);
  });
  it("expires failures promptly, expires success later and bounds the cache", async () => {
    let now = 0; const cache = new SummaryCache(2, () => now);
    const generate = vi.fn(async () => ({ value: "Fallback", status: { provider: "local", mode: "fallback" as const } }));
    await cache.get("one", generate); await cache.get("one", generate); expect(generate).toHaveBeenCalledTimes(1);
    now = 30_001; await cache.get("one", generate); expect(generate).toHaveBeenCalledTimes(2);
    await cache.get("two", generate); await cache.get("three", generate); await cache.get("one", generate); expect(generate).toHaveBeenCalledTimes(5);
    const good = vi.fn(async () => ({ value: "Summary", status: { provider: "test", mode: "llm" as const } }));
    await cache.get("good", good); now += 31_000; await cache.get("good", good); expect(good).toHaveBeenCalledTimes(1);
    now += 30 * 60_000; await cache.get("good", good); expect(good).toHaveBeenCalledTimes(2);
  });
});
