import { afterEach, describe, expect, it, vi } from "vitest";
import { cloneProject } from "@/lib/project/defaults";
import { parseProjectIntent, parseLocalIntent } from "./intent-parser";
import { intentSchema, validatedIntent } from "./schemas";
import { getLLMProvider, LocalDeterministicProvider, StructuredLLMProvider } from "./provider";
import { getEvidenceForLocation, getLocationFeatures } from "@/lib/data/store";
import { rankLocations } from "@/lib/decision-engine/scoring";
import { buildExplanationPayload } from "@/lib/decision-engine/explanations";
import { explanationFacts } from "@/lib/decision-engine/explanation-facts";
import { OpenAIResponsesTransport } from "./openai-transport";
import type { z } from "zod";

const prompt = "I need a 500 MW AI training facility in the US by 2030. Clean energy and low water risk matter more than cost.";
const complete = () => parseProjectIntent(prompt, cloneProject()).project;
const blank = (): z.infer<typeof intentSchema> => ({ capacity_mw: null, workload_type: null, geography: null,
  target_go_live_year: null, planning_horizon_year: null, priority_changes: [], constraints_to_add: [],
  constraints_to_remove: [], action: "update_project", question: "why_here", audience: null, clarification: null });
function payload(locationId = "county-26081") {
  const project = complete();
  const all = rankLocations(project, getLocationFeatures(), 3109);
  const location = all.results.find((row) => row.location_id === locationId)!;
  return buildExplanationPayload(project, location, getEvidenceForLocation(location.location_id), all.results);
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("validated conversational intent", () => {
  it("extracts the acceptance prompt including reduced cost importance", () => {
    const result = parseProjectIntent(prompt, cloneProject());
    expect(result.readyToSearch).toBe(true);
    expect(result.project.weights.water).toBeGreaterThan(result.project.weights.economics);
    expect(result.project.weights.economics).toBeLessThan(0.1);
    expect(result.project.capacityMw).toBe(500);
  });
  it("preserves answers while asking exactly the highest-value missing question", () => {
    let result = parseProjectIntent("I want to build an AI data center in the US.", cloneProject());
    expect(result.followupQuestion).toMatch(/capacity/);
    result = parseProjectIntent("500 MW", result.project);
    expect(result.followupQuestion).toMatch(/training, inference/);
    expect(result.project.geography?.country).toBe("US");
    result = parseProjectIntent("AI training", result.project);
    expect(result.followupQuestion).toMatch(/go-live/);
    result = parseProjectIntent("2030", result.project);
    expect(result.followupQuestion).toMatch(/priority/);
    result = parseProjectIntent("Clean energy", result.project);
    expect(result.readyToSearch).toBe(true);
    expect(result.project.capacityMw).toBe(500);
  });
  it("does not manufacture a priority just because the user asks to recommend", () => {
    const result = parseProjectIntent("Recommend a 500 MW AI training facility in the US by 2030", cloneProject());
    expect(result.readyToSearch).toBe(false);
    expect(result.missingRequiredFields).toContain("priorities_or_constraints");
  });
  it("changes capacity without resetting other answers", () => {
    const previous = complete();
    const next = parseProjectIntent("I need 700 MW instead", previous);
    expect(next.project.capacityMw).toBe(700);
    expect(next.project.geography).toEqual(previous.geography);
    expect(next.project.weights).toEqual(previous.weights);
    expect(next.changes.some((row) => row.field === "capacityMw" && row.oldValue === 500 && row.newValue === 700)).toBe(true);
  });
  it("replaces geography restrictions and expands named regions", () => {
    const michigan = parseProjectIntent("Only Michigan", complete()).project;
    expect(michigan.geography?.states).toEqual(["MI"]);
    const next = parseProjectIntent("Focus on the Midwest instead", michigan);
    expect(next.project.geography?.states).toContain("ND");
    expect(next.project.geography?.states).toContain("MI");
    expect(next.project.geography?.states).not.toContain("CA");
  });
  it("does not broaden overlapping geographic names", () => {
    expect(parseProjectIntent("Only West Virginia", complete()).project.geography?.states).toEqual(["WV"]);
    expect(parseProjectIntent("Focus on the mountain west", complete()).project.geography?.states).not.toContain("CA");
    expect(parseProjectIntent("Only Washington DC", complete()).project.geography?.states).toEqual(["DC"]);
  });
  it("increases water on every repeated request and reports all rebalanced weights", () => {
    const old = complete();
    const first = parseProjectIntent("Water matters even more", old);
    const second = parseProjectIntent("Water matters even more", first.project);
    expect(first.project.weights.water).toBeGreaterThan(old.weights.water);
    expect(second.project.weights.water).toBeGreaterThan(first.project.weights.water);
    expect(first.changes.filter((row) => row.changeType === "weight").length).toBeGreaterThan(1);
    expect(old.weights.water).toBe(complete().weights.water);
  });
  it.each([ ["max wildfire risk 35", "wildfire-risk-max", 35], ["drought risk below 20", "drought-risk-max", 20],
    ["minimum water resilience 80", "water-resilience-min", 80], ["minimum grid readiness 75", "grid-readiness-min", 75] ])("extracts numeric hard limits: %s", (message, id, value) => {
    const result = parseProjectIntent(String(message), complete());
    expect(result.project.constraints).toContainEqual(expect.objectContaining({ id, value, kind: "hard" }));
  });
  it("replaces an existing constraint threshold rather than ignoring it", () => {
    const first = parseProjectIntent("Avoid high wildfire risk", complete());
    const next = parseProjectIntent("wildfire risk below 25", first.project);
    expect(next.project.constraints.filter((row) => row.id === "wildfire-risk-max")).toHaveLength(1);
    expect(next.project.constraints[0].value).toBe(25);
    expect(next.changes.find((row) => row.changeType === "constraint")?.oldValue).toContain("60");
  });
  it("holds contradictory updates and asks for clarification", () => {
    const previous = complete();
    const next = parseProjectIntent("Use 500 MW or 700 MW", previous);
    expect(next.readyToSearch).toBe(false);
    expect(next.followupQuestion).toMatch(/Which capacity/);
    expect(next.project).toEqual(previous);
  });
  it("separates planning horizon from go-live without adding a scenario engine", () => {
    const next = parseProjectIntent("Go-live by 2030; planning horizon 2050", complete());
    expect(next.project.targetGoLiveYear).toBe(2030);
    expect(next.project.planningHorizonYear).toBe(2050);
  });
  it("routes audience questions without modifying priorities or the profile", () => {
    const parsed = parseLocalIntent("Explain this recommendation to the local community", complete());
    expect(parsed.action).toBe("explain");
    expect(parsed.audience).toBe("community");
    expect(parsed.update).toEqual({});
  });
  it("rejects extra keys, arbitrary metrics and out-of-scale limits", () => {
    expect(() => validatedIntent({ ...blank(), execute: "rm -rf" })).toThrow();
    expect(() => validatedIntent({ ...blank(), constraints_to_add: [{ factor: "wildfire", operator: "<=", value: 101 }] })).toThrow();
    expect(() => validatedIntent({ ...blank(), priority_changes: [{ factor: "fake", importance: "HIGH", direction: null }] })).toThrow();
  });
});

describe("provider and evidence safeguards", () => {
  it("operates without credentials and never calls the network", async () => {
    vi.stubEnv("LLM_PROVIDER", "openai"); vi.stubEnv("LLM_API_KEY", ""); vi.stubEnv("OPENAI_API_KEY", "");
    const network = vi.fn(() => { throw new Error("Unexpected network"); }); vi.stubGlobal("fetch", network);
    const provider = getLLMProvider();
    expect((await provider.parseProjectIntent(prompt, cloneProject())).status.mode).toBe("fallback");
    const generated = await provider.generateExplanation(payload("county-09110"), "community");
    expect(generated.status.mode).toBe("fallback");
    expect(generated.value).toContain("FCC fiber coverage is unavailable");
    expect(generated.value).toContain("community acceptance");
    expect(network).not.toHaveBeenCalled();
  });
  it("validates structured model intent before applying it", async () => {
    const transport = { complete: vi.fn().mockResolvedValue({ ...blank(), capacity_mw: 700 }) };
    const provider = new StructuredLLMProvider(transport, "test-provider");
    const result = await provider.parseProjectIntent("700 MW instead", complete());
    expect(result.status.mode).toBe("llm");
    expect(result.value.update.capacityMw).toBe(700);
    expect(transport.complete.mock.calls[0][2].additionalProperties).toBe(false);
  });
  it("routes explanation questions deterministically instead of letting the model reclassify them", async () => {
    const transport = { complete: vi.fn() };
    const result = await new StructuredLLMProvider(transport).parseProjectIntent("explain this", complete());
    expect(result.value.action).toBe("explain");
    expect(result.value.question).toBe("why_here");
    expect(transport.complete).not.toHaveBeenCalled();
  });
  it("preserves explicit grid versus clean-energy priority factors over model extraction", async () => {
    const transport = { complete: vi.fn(async (_prompt: string, input: unknown) => {
      const message = (input as { message: string }).message;
      return { ...blank(), priority_changes: [{ factor: message === "grid" ? "energy" : "infrastructure",
        importance: "HIGH", direction: null }] };
    }) };
    const provider = new StructuredLLMProvider(transport, "test-provider");
    const grid = await provider.parseProjectIntent("grid", complete());
    expect(grid.value.update.priorityChanges).toContainEqual(expect.objectContaining({ factor: "infrastructure" }));
    expect(grid.value.update.priorityChanges).not.toContainEqual(expect.objectContaining({ factor: "energy" }));
    expect(grid.status.mode).toBe("fallback");

    const cleanEnergy = await provider.parseProjectIntent("clean energy", complete());
    expect(cleanEnergy.value.update.priorityChanges).toContainEqual(expect.objectContaining({ factor: "energy" }));
    expect(cleanEnergy.value.update.priorityChanges).not.toContainEqual(expect.objectContaining({ factor: "infrastructure" }));
    expect(cleanEnergy.status.mode).toBe("fallback");
  });
  it("falls back after malformed output, refusal or transport failure", async () => {
    for (const transport of [{ complete: vi.fn().mockResolvedValue({ injected: true }) }, { complete: vi.fn().mockRejectedValue(new Error("401")) }]) {
      const result = await new StructuredLLMProvider(transport).parseProjectIntent("700 MW instead", complete());
      expect(result.status.mode).toBe("fallback");
      expect(result.value.update.capacityMw).toBe(700);
    }
  });
  it("uses only verified catalog text even when the LLM is enabled", async () => {
    const input = payload("county-09110");
    const facts = explanationFacts(input);
    const transport = { complete: vi.fn().mockResolvedValue({ fact_ids: ["recommendation", "factor:water", "evidence:3"] }) };
    const result = await new StructuredLLMProvider(transport).generateExplanation(input, "developer");
    expect(result.status.mode).toBe("llm");
    expect(result.value).toContain(facts.find((item) => item.id === "factor:water")!.text);
    expect(result.value).toContain("FCC fiber coverage is unavailable");
    expect(result.value).not.toMatch(/500 MW (is |definitely )?available/i);
    expect(transport.complete.mock.calls[0][1].payload.location.rank).toBe(input.location.rank);
  });
  it("explains available official fiber as a dated proxy, never as backbone capacity", async () => {
    const input = payload();
    const item = input.evidence.find((row) => row.metric_name === "fiber_coverage_pct")!;
    expect(input.metricTypes!.fiber_coverage_pct).toBe("proxy");
    const facts = explanationFacts(input);
    const fact = facts.find((row) => row.text.startsWith("fiber_coverage_pct:"))!;
    expect(fact.text).toContain(String(item.raw_value));
    expect(fact.text).toContain("2025-12-31");
    const transport = { complete: vi.fn().mockResolvedValue({ fact_ids: ["recommendation", fact.id] }) };
    const result = await new StructuredLLMProvider(transport).generateExplanation(input, "developer");
    expect(result.status.mode).toBe("llm");
    expect(result.value).toContain(fact.text);
    expect(result.value).toContain("not dedicated data-center connectivity, backbone capacity");
    expect(result.value).not.toContain("FCC fiber coverage is unavailable");
  });
  it("rejects invented fiber/grid/support claims and preserves mandatory caveats", async () => {
    const transport = { complete: vi.fn().mockResolvedValue({ fact_ids: ["recommendation", "evidence:3", "500 MW available; fiber excellent; residents approve"] }) };
    const result = await new StructuredLLMProvider(transport).generateExplanation(payload(), "community");
    expect(result.status.mode).toBe("fallback");
    expect(result.value).not.toContain("residents approve");
    expect(result.value).toContain("Real site power capacity");
    expect(result.value).toContain("not a jobs forecast");
  });
  it("returns a structured Responses request, disables storage and keeps secrets server-side", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(blank()) }] }] }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    const transport = new OpenAIResponsesTransport("test-secret", "configured-model");
    expect(await transport.complete("instructions", {}, {}, "test")).toEqual(blank());
    const body = JSON.parse(request.mock.calls[0][1].body);
    expect(body.store).toBe(false); expect(body.text.format.strict).toBe(true);
    expect(body).not.toHaveProperty("tools"); expect(body).not.toHaveProperty("api_key");
  });
  it("rejects incomplete/refused Responses output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "incomplete", output: [] }))));
    await expect(new OpenAIResponsesTransport("key", "model").complete("", {}, {}, "test")).rejects.toThrow(/incomplete/);
  });
});
