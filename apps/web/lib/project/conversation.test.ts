import { describe, expect, it, vi } from "vitest";
import { converse } from "./conversation";
import { LocalDeterministicProvider, StructuredLLMProvider } from "@/lib/llm/provider";
import { cloneProject } from "./defaults";
import { getLocationFeatures } from "@/lib/data/store";
import { rankLocations } from "@/lib/decision-engine/scoring";
import { categoryKeys } from "@/lib/types/domain";
import { POST as search } from "@/app/api/locations/search/route";
import { POST as parse } from "@/app/api/project/parse-intent/route";
import type { intentSchema } from "@/lib/llm/schemas";
import type { z } from "zod";

const prompt = "I need a 500 MW AI training facility in the US by 2030. Clean energy and low water risk matter more than cost.";
const provider = new LocalDeterministicProvider();
const start = () => converse({ message: prompt }, provider);

describe("canonical conversation and deterministic deltas", () => {
  it("runs structured-provider extraction, deterministic reranking and grounded explanation end-to-end", async () => {
    const raw: z.infer<typeof intentSchema> = { capacity_mw: 500, workload_type: "AI_TRAINING",
      geography: { country: "US", states: [], regions: [] }, target_go_live_year: 2030,
      planning_horizon_year: null, priority_changes: [{ factor: "water", importance: "VERY_HIGH", direction: null }],
      constraints_to_add: [], constraints_to_remove: [], action: "update_project", question: "why_here", audience: null, clarification: null };
    const transport = { complete: vi.fn(async (_prompt: string, input: unknown, _schema: unknown, name: string) => {
      const data = input as { message?: string; facts?: Array<{ id: string }> };
      if (name === "grounded_explanation") return { fact_ids: ["recommendation", "evidence:3",
        data.facts!.find((row) => row.id.startsWith("change:county:"))!.id] };
      if (data.message === "Water matters even more") return { ...raw, capacity_mw: null, workload_type: null,
        geography: null, target_go_live_year: null, priority_changes: [{ factor: "water", importance: null, direction: "increase" }] };
      if (data.message === "Why did the ranking change?") return { ...raw, action: "explain", question: "ranking_change", priority_changes: [] };
      return raw;
    }) };
    const remote = new StructuredLLMProvider(transport, "mock-remote");
    const first = await converse({ message: prompt }, remote);
    const next = await converse({ message: "Water matters even more", currentProject: first.project }, remote);
    const explained = await converse({ message: "Why did the ranking change?", currentProject: next.project, previousProject: first.project }, remote);
    expect(first.provider!.mode).toBe("llm"); expect(explained.provider!.mode).toBe("llm");
    expect(next.search!.results).toEqual(rankLocations(next.project, getLocationFeatures(), 3109).results.slice(0, 20));
    expect(explained.assistantMessage).toContain("backbone");
    expect(explained.project).toEqual(next.project);
    expect(explained.assistantMessage).toContain(`rank ${explained.rankingChange!.locations[0].oldRank} to ${explained.rankingChange!.locations[0].newRank}`);
  });
  it("rejects malformed JSON, message types and arbitrary input keys without executing them", async () => {
    for (const body of ["{broken", JSON.stringify({ message: 500 }), JSON.stringify({ message: "500 MW", execute: "code" })]) {
      const response = await parse(new Request("http://localhost/api/project/parse-intent", { method: "POST", body }));
      expect(response.status).toBe(400);
    }
  });
  it("does not recommend until explicit backend intake requirements are satisfied", async () => {
    const result = await converse({ message: "I want an AI data center in the US" }, provider);
    expect(result.readyToSearch).toBe(false); expect(result.search).toBeUndefined();
    expect(result.followupQuestion).toMatch(/capacity/);
    const direct = await search(new Request("http://localhost/api/locations/search", { method: "POST", body: JSON.stringify({ project: {} }) }));
    expect(direct.status).toBe(422);
    expect((await direct.json()).followupQuestion).toMatch(/capacity/);
  });
  it("chat uses exactly the engine's real-feature ranking", async () => {
    const first = await start();
    const expected = rankLocations(first.project, getLocationFeatures(), 3109);
    expect(first.search?.dataMode).toBe("public_data");
    expect(first.search?.results).toEqual(expected.results.slice(0, 20));
    expect(first.search?.feasibleCount).toBe(expected.results.length);
    expect(first.provider?.mode).toBe("fallback");
  });
  it("computes actual old/new ranks, scores and contributions across the full store", async () => {
    const first = await start();
    const selectedId = first.search!.results[0].location_id;
    const next = await converse({ message: "Water matters even more", currentProject: first.project, selectedLocationId: selectedId }, provider);
    const old = rankLocations(first.project, getLocationFeatures(), 3109);
    const after = rankLocations(next.project, getLocationFeatures(), 3109);
    const delta = next.rankingChange!.locations.find((row) => row.locationId === selectedId)!;
    const beforeRow = old.results.find((row) => row.location_id === selectedId)!;
    const afterRow = after.results.find((row) => row.location_id === selectedId)!;
    expect(delta.oldRank).toBe(beforeRow.rank); expect(delta.newRank).toBe(afterRow.rank);
    expect(delta.oldScore).toBe(beforeRow.overall_score); expect(delta.newScore).toBe(afterRow.overall_score);
    for (const factor of categoryKeys) {
      const item = delta.factors.find((row) => row.factor === factor)!;
      expect(item.oldContribution).toBe(beforeRow.weighted_contributions[factor]);
      expect(item.newContribution).toBe(afterRow.weighted_contributions[factor]);
      expect(item.difference).toBeCloseTo(item.newContribution - item.oldContribution);
    }
    expect(next.project.weights.water).toBeGreaterThan(first.project.weights.water);
  });
  it("ranking-change explanations cite computed deltas and never modify the project", async () => {
    const first = await start();
    const next = await converse({ message: "Water matters even more", currentProject: first.project }, provider);
    const explanation = await converse({ message: "Why did the ranking change?", currentProject: next.project, previousProject: first.project }, provider);
    expect(explanation.project).toEqual(next.project); expect(explanation.changes).toEqual([]);
    const delta = explanation.rankingChange!.locations[0];
    expect(explanation.assistantMessage).toContain(`rank ${delta.oldRank} to ${delta.newRank}`);
    expect(explanation.assistantMessage).toContain(`score ${delta.oldScore} to ${delta.newScore}`);
    expect(explanation.rankingChange!.changes.some((row) => row.field === "weights.water")).toBe(true);
    expect(explanation.explanationPayload?.question).toBe("ranking_change");
  });
  it("does not invent historical changes without a previous complete profile", async () => {
    const first = await start();
    const explained = await converse({ message: "Why did the ranking change?", currentProject: first.project }, provider);
    expect(explained.assistantMessage).toContain("No previous complete project profile");
    expect(explained.rankingChange).toBeUndefined();
  });
  it("computes feasibility transitions before rankings after a new hard limit", async () => {
    const first = await start();
    const maricopa = "county-04013";
    const next = await converse({ message: "wildfire risk below 10", currentProject: first.project, selectedLocationId: maricopa }, provider);
    expect(next.search!.results.every((row) => row.feasibility.is_feasible)).toBe(true);
    expect(next.rankingChange!.newlyExcludedCount).toBeGreaterThan(0);
    const row = next.rankingChange!.locations.find((item) => item.locationId === maricopa)!;
    expect(row.newRank).toBeNull(); expect(row.newlyFailedConstraints.length).toBeGreaterThan(0);
    const removed = await converse({ message: "Remove the wildfire restriction", currentProject: next.project, selectedLocationId: maricopa }, provider);
    expect(removed.rankingChange!.newlyFeasibleCount).toBeGreaterThan(0);
    expect(removed.rankingChange!.locations.find((item) => item.locationId === maricopa)!.newlyPassedConstraints.length).toBeGreaterThan(0);
  });
  it("enforces geography and capacity changes while keeping earlier answers", async () => {
    const first = await start();
    const next = await converse({ message: "I need 700 MW in Michigan instead", currentProject: first.project }, provider);
    expect(next.project.capacityMw).toBe(700); expect(next.project.targetGoLiveYear).toBe(2030);
    expect(next.search!.results.every((row) => row.state_code === "MI")).toBe(true);
    expect(next.search!.results.every((row) => row.feasibility.warnings.some((warning) => warning.includes("Power readiness is unavailable")))).toBe(true);
  });
  it("enforces a fiber threshold using the real FCC measurements", async () => {
    const first = await start();
    const next = await converse({ message: "Require fiber coverage at least 90", currentProject: first.project }, provider);
    const expected = rankLocations(next.project, getLocationFeatures(), getLocationFeatures().length);
    expect(next.search!.results).toEqual(expected.results.slice(0, 20));
    expect(next.search!.feasibleCount).toBe(expected.results.length);
    expect(next.search!.feasibleCount).toBeGreaterThan(0);
    expect(next.search!.results.every((row) => row.category_scores.infrastructure! >= 90)).toBe(true);
    expect(next.assistantMessage).toContain("9 counties");
  });
  it("rejects unknown fiber in Connecticut without allocating former counties", async () => {
    const first = await start();
    const project = cloneProject(first.project); project.geography = { country: "US", states: ["CT"] };
    const next = await converse({ message: "Require fiber coverage at least 90", currentProject: project }, provider);
    expect(next.search!.results).toHaveLength(0);
    const missing = next.search!.excluded.filter((row) => row.state_code === "CT");
    expect(missing).toHaveLength(9);
    expect(missing.every((row) => row.feasibility.failed_constraints.some((reason) => reason.includes("evidence is unavailable")))).toBe(true);
    expect(next.assistantMessage).toContain("fiber evidence is unavailable");
  });
  it.each(["Why here?", "Why not the second-best location?", "What are the biggest risks?", "What trade-off drove the result?", "What would make location B outrank A?"])("routes a grounded question: %s", async (message) => {
    const first = await start();
    const explained = await converse({ message, currentProject: first.project }, provider);
    expect(explained.explanationPayload).toBeDefined();
    expect(explained.project).toEqual(first.project);
    expect(explained.assistantMessage).toContain("backbone");
    expect(explained.assistantMessage).not.toContain("residents approve");
  });
  it("uses the same evidence and scores for all three audience modes", async () => {
    const first = await start();
    const outputs = await Promise.all(["developer", "government", "community"].map((audience) =>
      converse({ message: "Why here?", currentProject: first.project, audience }, provider)));
    expect(outputs[0].explanationPayload!.evidence).toEqual(outputs[2].explanationPayload!.evidence);
    expect(outputs[0].explanationPayload!.location.category_scores).toEqual(outputs[1].explanationPayload!.location.category_scores);
    expect(outputs[2].assistantMessage).toContain("Community review");
    expect(outputs[2].assistantMessage).toContain("not a jobs forecast or resident support");
  });
  it("shows all actual changes when filters supply a new canonical project", async () => {
    const first = await start();
    const project = cloneProject(first.project); project.capacityMw = 700;
    const next = await converse({ message: "Evaluate the current project.", currentProject: project, previousProject: first.project }, provider);
    expect(next.changes).toContainEqual(expect.objectContaining({ field: "capacityMw", oldValue: 500, newValue: 700 }));
    expect(next.search!.project).toEqual(next.project);
  });
  it("does not consult an LLM when authoritative filter values are supplied", async () => {
    const first = await start();
    const parse = vi.fn().mockRejectedValue(new Error("Filters must bypass parsing"));
    const next = await converse({ source: "filters", message: "Evaluate the current project.",
      currentProject: first.project, previousProject: first.project }, { parseProjectIntent: parse, generateExplanation: vi.fn() });
    expect(parse).not.toHaveBeenCalled();
    expect(next.search!.results.length).toBe(20);
    expect(next.provider!.provider).toBe("engine");
  });
});
