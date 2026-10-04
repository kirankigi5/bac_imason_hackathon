import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { clearLocationSummaryResources, useLocationSummary } from "./use-location-summary";
import { decisionTrace } from "@/lib/decision-engine/decision-trace";
import { cloneProject } from "@/lib/project/defaults";
import { buildSummaryFacts, renderSummary } from "@/lib/llm/location-summary";
import type { Audience, DecisionTrace } from "@/lib/types/domain";

const project = cloneProject({ capacityMw: 500, workloadType: "AI_TRAINING", targetGoLiveYear: 2030, activePrioritySignals: ["water"] });
const first = decisionTrace(project, "county-46021"), second = decisionTrace(project, "county-46107");
const text = (trace: DecisionTrace, audience: Audience) => renderSummary(buildSummaryFacts(trace, project, "Selected county", "US"), audience, ["intro:alternative", "status:observed", "diligence:audience"]);
function Summary({ trace = first, audience = "developer", revision = 1 }: { trace?: DecisionTrace; audience?: Audience; revision?: number }) {
  const result = useLocationSummary(trace, project, audience, "Selected county", "US", revision);
  return <p data-testid="summary" aria-busy={result.loading}>{result.text}</p>;
}
beforeEach(clearLocationSummaryResources);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearLocationSummaryResources(); });
describe("selected-location request lifecycle", () => {
  it("immediately displays fallback, generates once, and reuses it across renders and remounts", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ summary: text(first, "developer"), provider: { provider: "mock", mode: "llm" } })));
    vi.stubGlobal("fetch", fetch);
    const view = render(<Summary />);
    expect(screen.getByTestId("summary").textContent!.split(/\s+/).length).toBeGreaterThanOrEqual(50);
    await waitFor(() => expect(screen.getByTestId("summary").getAttribute("aria-busy")).toBe("false"));
    view.rerender(<Summary />); view.unmount(); render(<Summary />);
    await waitFor(() => expect(screen.getByTestId("summary").getAttribute("aria-busy")).toBe("false"));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["county", "audience", "revision", "ranking"])("invalidates a changed %s", async (change) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ summary: text(first, "developer"), provider: { mode: "llm" } })));
    vi.stubGlobal("fetch", fetch); const view = render(<Summary />);
    await waitFor(() => expect(screen.getByTestId("summary").getAttribute("aria-busy")).toBe("false"));
    view.rerender(<Summary trace={change === "county" ? second : change === "ranking" ? { ...first, overall_score: first.overall_score + 1 } : first}
      audience={change === "audience" ? "community" : "developer"} revision={change === "revision" ? 2 : 1} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
  it.each(["http", "invalid"])("never leaves the panel empty after %s failure", async (failure) => {
    vi.stubGlobal("fetch", vi.fn(async () => failure === "http" ? new Response("Unavailable", { status: 503 }) : new Response(JSON.stringify({ summary: "bad", provider: { mode: "llm" } }))));
    render(<Summary />); await waitFor(() => expect(screen.getByTestId("summary").getAttribute("aria-busy")).toBe("false"));
    expect(screen.getByTestId("summary").textContent).toContain("not verified");
    expect(screen.getByTestId("summary").textContent!.split(/\s+/).length).toBeGreaterThanOrEqual(50);
  });
  it("cannot replace a new county explanation with a late old response", async () => {
    const requests: Array<(value: Response) => void> = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => requests.push(resolve))));
    const view = render(<Summary />); view.rerender(<Summary trace={second} />);
    await act(async () => { requests[1](new Response(JSON.stringify({ summary: text(second, "developer"), provider: { mode: "llm" } }))); });
    expect(screen.getByTestId("summary").textContent).toBe(text(second, "developer"));
    await act(async () => { requests[0](new Response(JSON.stringify({ summary: text(first, "developer"), provider: { mode: "llm" } }))); });
    expect(screen.getByTestId("summary").textContent).toBe(text(second, "developer"));
  });
});
