import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Home from "./page";
import { converse } from "@/lib/project/conversation";
import { LocalDeterministicProvider } from "@/lib/llm/provider";
import { rankingDiff } from "@/lib/backend/ranking-diff";
import type { ProjectState, RankedLocation } from "@/lib/types/domain";
import { prioritiesFromWeights } from "@/lib/frontend/priorities";
import { tutorialStorageKey } from "@/components/scoring/ScoringTutorial";
import { resetBrowserStorage } from "@/test/browser-storage";

vi.mock("@/components/map/DecisionMap", () => ({ DecisionMap: ({ results }: { results: RankedLocation[] }) =>
  <div data-testid="map-results">{results.map((row) => <span key={row.location_id}>{row.location_id}</span>)}</div> }));
vi.mock("@/components/location/LocationDetail", () => ({ LocationDetail: () => null }));
vi.mock("@/components/compare/ComparePanel", () => ({ ComparePanel: () => null }));
beforeEach(() => { resetBrowserStorage(); window.localStorage.setItem(tutorialStorageKey, "true"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

function setup() {
  const calls: Array<{ message: string; currentProject?: unknown; responseQuestion: string; hasExplanation: boolean }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/status")) return new Response(JSON.stringify({ provider: "local", mode: "fallback" }));
    if (url === "/api/projects") return new Response(JSON.stringify({ projects: [] }));
    if (url === "/api/ranking/diff") {
      const body = JSON.parse(String(options?.body));
      return new Response(JSON.stringify(rankingDiff(body.before_project, body.after_project, body.location_ids, body.top_n)));
    }
    const input = JSON.parse(String(options?.body));
    const response = await converse(input, new LocalDeterministicProvider());
    calls.push({ ...input, responseQuestion: response.question, hasExplanation: !!response.explanationPayload });
    return new Response(JSON.stringify(response));
  }));
  render(<Home />);
  return calls;
}
async function send(message: string) {
  closeDialog();
  fireEvent.change(screen.getByRole("textbox", { name: "Project message" }), { target: { value: message } });
  fireEvent.click(screen.getByRole("button", { name: "Find Locations" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Find Locations" }).getAttribute("aria-busy")).toBe("false"));
}
function closeDialog() { const dialog = screen.queryByRole("dialog"); if (dialog) fireEvent.click(within(dialog).getByRole("button", { name: /^Close / })); }
function edit() { closeDialog(); fireEvent.click(screen.getByRole("button", { name: "Edit Criteria" })); }

describe("chat/filter state synchronization", () => {
  it("updates visible filters and real map results from the same canonical response", async () => {
    const calls = setup();
    await send("I need a 500 MW AI training facility in the US by 2030. Clean energy and low water risk matter more than cost.");
    expect(screen.getByText("500 MW")).toBeTruthy();
    expect(screen.getByText("Public feature store")).toBeTruthy();
    expect(screen.getByTestId("map-results").children).toHaveLength(20);
    edit(); const initial = (calls.at(-1)!.currentProject as ProjectState | undefined);
    const otherPriority = Number((screen.getByRole("slider", { name: "Power & Clean Energy priority" }) as HTMLInputElement).value);
    await send("Water matters even more");
    edit(); const canonical = (calls.at(-1)!.currentProject as ProjectState);
    expect(Number((screen.getByRole("slider", { name: "Water Resilience priority" }) as HTMLInputElement).value)).toBeGreaterThanOrEqual(Math.round(prioritiesFromWeights(initial?.weights ?? canonical.weights).water));
    expect(Number((screen.getByRole("slider", { name: "Power & Clean Energy priority" }) as HTMLInputElement).value)).toBeLessThan(otherPriority);
    expect(screen.getAllByText(/Water Resilience/).length).toBeGreaterThan(1);
    closeDialog(); fireEvent.click(screen.getByRole("button", { name: "Project" }));
    expect(screen.getByText("Rule-based fallback")).toBeTruthy();
  });
  it("feeds a filter update back into the profile subsequently supplied to chat", async () => {
    const calls = setup();
    await send("I need a 500 MW AI training facility in the US by 2030 with low water risk");
    edit(); const initialInputs = Object.fromEntries([...screen.getAllByRole("slider")].map((node) => [node.id.replace("priority-", ""), Number((node as HTMLInputElement).value)]));
    const slider = screen.getByRole("slider", { name: "Water Resilience priority" });
    fireEvent.change(slider, { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Criteria" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Find Locations" }).getAttribute("aria-busy")).toBe("false"));
    edit(); expect((screen.getByRole("slider", { name: "Water Resilience priority" }) as HTMLInputElement).value).toBe("50");
    await send("I need 700 MW instead");
    const submitted = calls.at(-1)!.currentProject as { weights: { water: number }; capacityMw: number };
    expect(submitted.weights.water).toBeCloseTo(50 / (Object.entries(initialInputs).filter(([key]) => key !== "water").reduce((sum, [, value]) => sum + value, 0) + 50), 3);
    expect(screen.getByText("700 MW")).toBeTruthy();
    edit(); expect((screen.getByRole("slider", { name: "Water Resilience priority" }) as HTMLInputElement).value).toBe("50");
  });
  it("preserves the prior project for ranking-change questions and audience switches", async () => {
    const calls = setup();
    await send("I need a 500 MW AI training facility in the US by 2030 with low water risk");
    await send("Water matters even more");
    await send("Why did the ranking change?");
    expect(screen.getByText(/same feature release was evaluated/)).toBeTruthy();
    expect(calls.at(-1)).toHaveProperty("previousProject");
    await send("Explain this recommendation to the local community");
    expect(screen.getByText(/Community review: water/)).toBeTruthy();
    expect(calls.at(-1)).toMatchObject({ responseQuestion: "why_here", hasExplanation: true });
    await screen.findByRole("dialog", { name: "Why this location?" });
    expect((await within(screen.getByRole("dialog")).findByRole("button", { name: "community" })).className).toContain("bg-aqua");
  });
});
