// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { cloneProject } from "./defaults";
import { getFollowupQuestion, getMissingRequiredFields } from "./validation";
import { finalizeIntent, parseProjectIntent } from "@/lib/llm/intent-parser";
import { LocalDeterministicProvider, StructuredLLMProvider } from "@/lib/llm/provider";
import { converse } from "./conversation";
import { getRanking } from "@/lib/backend/decisions";
import type { intentSchema } from "@/lib/llm/schemas";
import type { z } from "zod";

const blank = (): z.infer<typeof intentSchema> => ({ capacity_mw: null, workload_type: null, geography: null,
  target_go_live_year: null, planning_horizon_year: null, priority_changes: [], constraints_to_add: [],
  constraints_to_remove: [], action: "update_project", question: "why_here", audience: null, clarification: null });

describe("deterministic contextual intake", () => {
  it("defaults to complete nationwide geography without sharing mutable state", () => {
    const first = cloneProject(), second = cloneProject();
    expect(first.geography).toEqual({ country: "US", states: [] });
    first.geography!.states!.push("MI"); expect(second.geography!.states).toEqual([]);
    const missing = getMissingRequiredFields(second);
    expect(missing).toEqual(["capacity", "workload_type", "target_go_live_year", "priorities_or_constraints"]);
    delete second.geography;
    expect(getMissingRequiredFields(second)).toEqual(missing);
    expect(getFollowupQuestion(missing)).toMatch(/capacity/);
  });
  it.each(["500", "500 MW", "500MW", "around 500", "roughly 500"])("uses the capacity follow-up for %s without consulting a model", async (message) => {
    const transport = { complete: vi.fn().mockRejectedValue(new Error("Contextual answer must not need a model")) };
    const project = (await converse({ message: "hello" }, new LocalDeterministicProvider())).project;
    const response = await converse({ message, currentProject: project }, new StructuredLLMProvider(transport));
    expect(response.project.capacityMw).toBe(500); expect(response.project.targetGoLiveYear).toBeUndefined();
    expect(response.followupQuestion).toMatch(/training, inference/); expect(response.search).toBeUndefined();
    expect(response.project.geography).toEqual({ country: "US", states: [] });
    expect(transport.complete).not.toHaveBeenCalled();
  });
  it.each([["training", "AI_TRAINING"], ["inference", "AI_INFERENCE"], ["mixed", "MIXED"], ["cloud", "CLOUD"]])("accepts the workload answer %s", async (message, expected) => {
    const transport = { complete: vi.fn() }, current = cloneProject({ capacityMw: 500 });
    const response = await converse({ message, currentProject: current }, new StructuredLLMProvider(transport));
    expect(response.project.workloadType).toBe(expected); expect(response.project.capacityMw).toBe(500);
    expect(response.followupQuestion).toMatch(/go-live year/); expect(transport.complete).not.toHaveBeenCalled();
  });
  it("uses a unitless year only as a year when that is the active question", async () => {
    const transport = { complete: vi.fn() }, current = cloneProject({ capacityMw: 500, workloadType: "AI_TRAINING" });
    const response = await converse({ message: "2050", currentProject: current }, new StructuredLLMProvider(transport));
    expect(response.project).toMatchObject({ capacityMw: 500, workloadType: "AI_TRAINING", targetGoLiveYear: 2050 });
    expect(response.followupQuestion).toMatch(/priority/); expect(transport.complete).not.toHaveBeenCalled();
    const capacity = parseProjectIntent("2050", cloneProject());
    expect(capacity.project.capacityMw).toBe(2050); expect(capacity.project.targetGoLiveYear).toBeUndefined();
    expect(parseProjectIntent("2050 MW", cloneProject()).project.targetGoLiveYear).toBeUndefined();
  });
  it.each(["all", "all states", "Anywhere in the US", "nationwide"])("resets optional geography for %s without erasing accepted answers", async (message) => {
    const current = cloneProject({ capacityMw: 500, workloadType: "AI_TRAINING", targetGoLiveYear: 2050,
      geography: { country: "US", states: ["MI", "OH"] } });
    const transport = { complete: vi.fn() };
    const response = await converse({ message, currentProject: current }, new StructuredLLMProvider(transport));
    expect(response.project.geography).toEqual({ country: "US", states: [] });
    expect(response.project).toMatchObject({ capacityMw: 500, workloadType: "AI_TRAINING", targetGoLiveYear: 2050 });
    expect(response.followupQuestion).toMatch(/priority/); expect(transport.complete).not.toHaveBeenCalled();
  });
  it.each([null, 700])("rejects a partial model extraction that substitutes capacity %s", async (capacity) => {
    const transport = { complete: vi.fn().mockResolvedValue({ ...blank(), capacity_mw: capacity }) };
    const current = cloneProject(), message = "I am targeting 500 MW for my campus";
    const parsed = await new StructuredLLMProvider(transport).parseProjectIntent(message, current);
    expect(transport.complete).toHaveBeenCalled(); expect(parsed.status.mode).toBe("fallback");
    const response = finalizeIntent(parsed.value, current);
    expect(response.project.capacityMw).toBe(500); expect(response.followupQuestion).toMatch(/training, inference/);
  });
  it.each(["capacity", "workload", "year", "geography"] as const)("rejects an invented %s clarification for an accepted or optional field", async (clarification) => {
    const current = cloneProject({ capacityMw: 500, workloadType: "AI_TRAINING", targetGoLiveYear: 2050 });
    const transport = { complete: vi.fn().mockResolvedValue({ ...blank(), clarification }) };
    const parsed = await new StructuredLLMProvider(transport).parseProjectIntent("Please continue", current);
    const response = finalizeIntent(parsed.value, current);
    expect(response.project).toEqual(current); expect(response.followupQuestion).toMatch(/priority/);
  });
  it("ignores model attempts to overwrite accepted answers when the final priority arrives", async () => {
    const current = cloneProject({ capacityMw: 500, workloadType: "AI_TRAINING", targetGoLiveYear: 2050 });
    const transport = { complete: vi.fn().mockResolvedValue({ ...blank(), capacity_mw: 700, workload_type: "CLOUD",
      target_go_live_year: 2030, geography: { country: "US", states: ["TX"], regions: [] },
      priority_changes: [{ factor: "water", importance: "HIGH", direction: null }] }) };
    const response = await converse({ message: "clean energy and low water risk", currentProject: current }, new StructuredLLMProvider(transport));
    expect(response.project).toMatchObject({ capacityMw: 500, workloadType: "AI_TRAINING", targetGoLiveYear: 2050,
      geography: { country: "US", states: [] } });
    expect(response.readyToSearch).toBe(true); expect(response.followupQuestion).toBeNull();
    expect(response.search!.results).toEqual(getRanking(response.project).results.slice(0, 20));
  });
  it("recovers an all-geography answer between workload and year without re-asking workload", async () => {
    const current = cloneProject({ capacityMw: 500, workloadType: "AI_TRAINING" });
    const response = await converse({ message: "all", currentProject: current }, new StructuredLLMProvider({ complete: vi.fn() }));
    expect(response.project.workloadType).toBe("AI_TRAINING"); expect(response.project.geography).toEqual({ country: "US", states: [] });
    expect(response.followupQuestion).toMatch(/go-live year/);
  });
  it("permits a genuinely contradictory capacity clarification without changing accepted state", async () => {
    const current = cloneProject({ capacityMw: 500, workloadType: "AI_TRAINING", targetGoLiveYear: 2050 });
    const transport = { complete: vi.fn() };
    const response = await converse({ message: "Use 500 MW or 700 MW", currentProject: current }, new StructuredLLMProvider(transport));
    expect(response.project).toEqual(current); expect(response.followupQuestion).toMatch(/Which capacity/);
    expect(transport.complete).not.toHaveBeenCalled();
  });
});
