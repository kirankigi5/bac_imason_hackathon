import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import * as providers from "@/lib/llm/provider";
import { locationSummaryCache } from "@/lib/llm/summary-cache";
import { decisionTrace } from "@/lib/decision-engine/decision-trace";
import { cloneProject } from "@/lib/project/defaults";
import { summarySentences, type SummaryFacts } from "@/lib/llm/location-summary";
import type { Audience } from "@/lib/types/domain";

const project = cloneProject({ capacityMw: 500, workloadType: "AI_TRAINING", targetGoLiveYear: 2030, activePrioritySignals: ["energy", "water"] });
const id = "county-46021";
const request = (body: unknown, locationId = id) => POST(new Request("http://localhost/summary", { method: "POST", body: JSON.stringify(body) }),
  { params: Promise.resolve({ locationId }) });
beforeEach(() => { vi.stubEnv("LLM_PROVIDER", "local"); locationSummaryCache.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); locationSummaryCache.clear(); });
describe("selected-location summary endpoint", () => {
  it("generates a single grounded model summary for the same selected county, revision and audience", async () => {
    const transport = { complete: vi.fn(async (_instructions, input: { audience: Audience; facts: SummaryFacts }) => ({
      sentence_ids: ["intro:alternative", "status:observed", "diligence:audience"]
    })) };
    vi.spyOn(providers, "getLLMProvider").mockReturnValue(new providers.StructuredLLMProvider(transport, "mock-gemini"));
    const before = decisionTrace(project, id), body = { project, audience: "developer", revision: 3 };
    const first = await request(body), second = await request(body);
    expect(first.status).toBe(200); expect(second.status).toBe(200); expect(transport.complete).toHaveBeenCalledTimes(1);
    const result = await first.json(); expect(result).toEqual(await second.json()); expect(result.provider.mode).toBe("llm");
    expect(Object.keys(result).sort()).toEqual(["provider", "summary"]);
    const { facts, audience } = transport.complete.mock.calls[0][1];
    expect(facts.rank).toBe(before.rank); expect(facts.screening_score).toBe(before.overall_score);
    expect(facts.feasibility).toBe(before.feasibility.status); expect(audience).toBe("developer");
    expect(result.summary).toContain(summarySentences(facts, audience)["status:observed"]);
    expect(decisionTrace(project, id)).toEqual(before);
    expect(result.summary.split(/\s+/).length).toBeLessThanOrEqual(80);
    await request({ ...body, audience: "community" }); await request({ ...body, revision: 4 });
    await request({ ...body, project: cloneProject({ ...project, capacityMw: 700 }) });
    await request(body, "county-46107"); expect(transport.complete).toHaveBeenCalledTimes(5);
  });
  it("returns a concise nonempty fallback if the configured model fails", async () => {
    vi.spyOn(providers, "getLLMProvider").mockReturnValue(new providers.StructuredLLMProvider({ complete: vi.fn().mockRejectedValue(new Error("offline")) }));
    const response = await request({ project }); expect(response.status).toBe(200);
    const body = await response.json(); expect(body.provider.mode).toBe("fallback"); expect(body.summary).toContain("not verified");
    expect(body.summary.split(/\s+/).length).toBeGreaterThanOrEqual(50); expect(body.summary.split(/\s+/).length).toBeLessThanOrEqual(80);
  });
  it.each([{}, { project, audience: "invented" }, { project, revision: 0 }, { project, explanation: "Approved" }])("rejects malformed payload %#", async (body) => {
    expect((await request(body)).status).toBe(400);
  });
  it("rejects incomplete intake and unknown counties without making any model call", async () => {
    const getProvider = vi.spyOn(providers, "getLLMProvider");
    expect((await request({ project: cloneProject() })).status).toBe(422);
    expect((await request({ project }, "county-99999")).status).toBe(404); expect(getProvider).not.toHaveBeenCalled();
  });
});
