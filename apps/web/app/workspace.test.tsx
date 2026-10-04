import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Home from "./page";
import * as projects from "./api/projects/route";
import * as project from "./api/projects/[id]/route";
import * as history from "./api/projects/[id]/history/route";
import { POST as chat } from "./api/project/converse/route";
import { GET as status } from "./api/project/status/route";
import { POST as search } from "./api/locations/search/route";
import { GET as detail } from "./api/locations/[locationId]/route";
import { POST as trace } from "./api/locations/[locationId]/decision-trace/route";
import { POST as explain } from "./api/locations/[locationId]/explain/route";
import { POST as summary } from "./api/locations/[locationId]/summary/route";
import { clearLocationSummaryResources } from "@/lib/frontend/use-location-summary";
import { locationSummaryCache } from "@/lib/llm/summary-cache";
import { POST as compare } from "./api/compare/route";
import { POST as diff } from "./api/ranking/diff/route";
import { closeProjectRepository, getProjectRepository } from "@/lib/project/repository";
import { cloneProject } from "@/lib/project/defaults";
import { getRanking } from "@/lib/backend/decisions";
import type { DecisionTrace, RankedLocation } from "@/lib/types/domain";
import { getStoreSnapshot } from "@/lib/data/store";
import { versionsFor } from "@/lib/backend/decisions";
import { GeminiTransport } from "@/lib/llm/gemini-transport";
import { prioritiesFromWeights, weightsFromPriorities } from "@/lib/frontend/priorities";
import { tutorialStorageKey } from "@/components/scoring/ScoringTutorial";
import { resetBrowserStorage } from "@/test/browser-storage";
import * as candidateActions from "./actions/candidates";
import type { CandidatesRequest } from "./actions/candidates";

vi.mock("@/components/map/DecisionMap", () => ({ DecisionMap: ({ results, onSelect, disabled }: { results: RankedLocation[]; onSelect: (id: string) => void; disabled: boolean }) =>
  <div data-testid="map-results">{results.map((row) => <button key={row.location_id} disabled={disabled} data-map-location={row.location_id} data-map-score={row.overall_score} onClick={() => onSelect(row.location_id)}>{row.county_name}</button>)}</div> }));

type Call = { pathname: string; input: Record<string, any> | undefined; output: any; status: number };
let directory: string;
let calls: Call[];
let candidateRequests: CandidatesRequest[];
beforeEach(() => {
  candidateRequests = []; const load = candidateActions.loadCandidates;
  vi.spyOn(candidateActions, "loadCandidates").mockImplementation((input) => { candidateRequests.push(structuredClone(input)); return load(input); });
  resetBrowserStorage(); window.localStorage.setItem(tutorialStorageKey, "true");
  clearLocationSummaryResources(); locationSummaryCache.clear();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "county-workspace-"));
  vi.stubEnv("PROJECT_DB_PATH", path.join(directory, "projects.sqlite")); vi.stubEnv("LLM_PROVIDER", "local");
  window.history.replaceState(null, "", "/"); calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    const request = new Request(new URL(url, "http://localhost"), options), pathname = new URL(request.url).pathname;
    const input = options?.body ? JSON.parse(String(options.body)) : undefined;
    let response: Response;
    const county = pathname.match(/^\/api\/locations\/(county-\d{5})(?:\/(.*))?$/);
    const saved = pathname.match(/^\/api\/projects\/([^/]+)(?:\/(history))?$/);
    if (pathname === "/api/projects") response = request.method === "POST" ? await projects.POST(request) : await projects.GET();
    else if (saved) {
      const context = { params: Promise.resolve({ id: saved[1] }) };
      response = saved[2] ? await history.GET(request, context) : request.method === "PATCH" ? await project.PATCH(request, context) : await project.GET(request, context);
    } else if (county) {
      const context = { params: Promise.resolve({ locationId: county[1] }) };
      response = county[2] === "decision-trace" ? await trace(request, context) : county[2] === "explain" ? await explain(request, context)
        : county[2] === "summary" ? await summary(request, context) : await detail(request, context);
    } else if (pathname === "/api/project/status") response = await status();
    else if (pathname === "/api/project/converse") response = await chat(request);
    else if (pathname === "/api/locations/search") response = await search(request);
    else if (pathname === "/api/compare") response = await compare(request);
    else if (pathname === "/api/ranking/diff") response = await diff(request);
    else throw new Error("Unexpected API: " + pathname);
    calls.push({ pathname, input, output: await response.clone().json(), status: response.status }); return response;
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); closeProjectRepository(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); fs.rmSync(directory, { recursive: true, force: true }); });

const intake = "I need a 500 MW AI training facility in the US by 2030. Clean energy and water resilience matter more than cost.";
const latest = (pathname: string) => calls.filter((call) => call.pathname === pathname).at(-1)!;
async function idle() { await waitFor(() => expect(screen.getByRole("button", { name: "Find Locations" }).getAttribute("aria-busy")).toBe("false")); }
function closeDialog() { const dialog = screen.queryByRole("dialog"); if (dialog) fireEvent.click(within(dialog).getByRole("button", { name: /^Close / })); }
function projectSettings() { closeDialog(); fireEvent.click(screen.getByRole("button", { name: "Project" })); }
function save() { const dialog = screen.queryByRole("dialog", { name: "Project" }); fireEvent.click(dialog ? within(dialog).getByRole("button", { name: "Save project" }) : screen.getByRole("button", { name: "Save current project" })); }
function edit() { closeDialog(); fireEvent.click(screen.getByRole("button", { name: "Edit Criteria" })); }
async function apply() { fireEvent.click(screen.getByRole("button", { name: "Apply Criteria" })); await idle(); }
function expectRevision(revision: number) { projectSettings(); expect(screen.getByText(`Revision ${revision}`)).toBeTruthy(); closeDialog(); }
async function send(message: string) {
  closeDialog();
  fireEvent.change(screen.getByRole("textbox", { name: "Project message" }), { target: { value: message } });
  fireEvent.click(screen.getByRole("button", { name: "Find Locations" })); await idle();
}
async function ready() { render(<Home />); await waitFor(() => expect(calls.some((call) => call.pathname === "/api/project/status")).toBe(true)); await send(intake);
  await choose(latest("/api/project/converse").output.search.results[0].location_id); }
async function expand() {
  const scope = screen.queryByRole("dialog") ?? document.querySelector(".selected-workspace")!;
  fireEvent.click(await within(scope as HTMLElement).findByRole("button", { name: "View decision breakdown" }));
  await waitFor(() => expect(scope.querySelector(".explanation-tree")).toBeTruthy());
}
function chooseTab(name: RegExp) {
  closeDialog();
  if (name.test("Why?")) return;
  else if (name.test("Evidence")) fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
  else if (name.test("What Changed?")) fireEvent.click(screen.getByRole("button", { name: "Why did this change?" }));
  else if (name.test("Compare")) fireEvent.click(screen.getByRole("button", { name: /^Compare \(/ }));
  else if (name.test("History")) { projectSettings(); fireEvent.click(screen.getByRole("button", { name: "History" })); }
}
async function choose(id: string) {
  closeDialog();
  fireEvent.click(document.querySelector(`[data-map-location="${id}"]`)!); await idle();
  await waitFor(() => expect((screen.getByRole("button", { name: "View decision breakdown" }) as HTMLButtonElement).disabled).toBe(false));
}
function flattened(trace: DecisionTrace) {
  const ids: string[] = [];
  const visit = (node: DecisionTrace["explanation_graph"]["root"]) => { ids.push(node.id); node.children?.forEach(visit); };
  visit(trace.explanation_graph.root); return ids;
}

describe("frontend integration with real deterministic APIs", () => {
  it("keeps the default concise, preserves complete facts behind expansion and resets disclosure for new context", async () => {
    await ready();
    const scope = document.querySelector(".selected-workspace")!;
    const initial = latest("/api/project/converse").output, id = initial.search.results[0].location_id;
    const original = latest(`/api/locations/${id}/decision-trace`).output as DecisionTrace;
    expect(scope.querySelector(".explanation-tree")).toBeNull();
    expect(calls.some((call) => call.pathname.endsWith("/explain"))).toBe(false);
    for (const value of [original.data_release_id, original.scoring_version, original.normalization_version, ...original.warnings]) {
      expect(scope.textContent).not.toContain(value);
    }
    expect(scope.querySelectorAll("[data-summary-strength]")).toHaveLength(3);
    expect(scope.querySelectorAll("[data-summary-risk]")).toHaveLength(3);
    await expand();
    const second = initial.search.results[1].location_id; await choose(second);
    await waitFor(() => expect(screen.getByRole("button", { name: "View decision breakdown" }).getAttribute("aria-expanded")).toBe("false"));
    expect(scope.querySelector(".explanation-tree")).toBeNull();
    await expand();
    await send("I need 700 MW instead");
    await waitFor(() => expect(latest(`/api/locations/${second}/decision-trace`).input!.project.capacityMw).toBe(700));
    expect(scope.querySelector(".explanation-tree")).toBeNull();
    expect(scope.querySelector("[data-summary-risk=site-power]")!.textContent).toContain("700 MW site power");
  });
  it("selects a county and renders precisely the backend graph nodes", async () => {
    await ready(); const ranking = latest("/api/project/converse").output.search;
    const second = ranking.results[1]; await choose(second.location_id); chooseTab(/^Why\?/);
    const api = latest(`/api/locations/${second.location_id}/decision-trace`).output as DecisionTrace;
    expect(document.querySelector(".explanation-tree")).toBeNull(); await expand();
    await waitFor(() => expect([...document.querySelectorAll("[data-node-id]")].map((node) => node.getAttribute("data-node-id"))).toEqual(flattened(api)));
    expect(api.data_release_id).toBe(versionsFor(getStoreSnapshot()).data_release_id);
    expect(document.querySelector('[data-node-id="decision:' + second.location_id + '"]')!.textContent).toContain(String(api.overall_score));
  });
  it("displays raw evidence, quality and official links from the trace", async () => {
    await ready(); const id = latest("/api/project/converse").output.search.results[0].location_id;
    const api = latest(`/api/locations/${id}/decision-trace`).output as DecisionTrace;
    chooseTab(/^Evidence$/);
    await waitFor(() => expect(document.querySelectorAll("[data-evidence-id]").length).toBeGreaterThan(0));
    for (const metric of api.metrics) {
      const row = document.querySelector(`[data-evidence-id="${metric.evidence_id}"]`)!;
      expect(row).toBeTruthy(); expect(row.querySelector("[data-raw-value]")!.getAttribute("data-raw-value")).toBe(metric.value === null ? "missing" : String(metric.value));
      if (metric.source_url.startsWith("https://")) expect(row.querySelector("a")!.getAttribute("href")).toBe(metric.source_url);
      expect(row.textContent).toContain(metric.caveat);
      expect(JSON.parse(row.querySelector("[data-original-evidence]")!.textContent!)).toEqual(api.evidence.find((item) => item.evidence_id === metric.evidence_id));
    }
  });
  it("uses the ranking-diff API after a manual filter and updates real map scores", async () => {
    await ready(); const accepted = latest("/api/project/converse").output;
    const before = { ...accepted.project, selectedLocationId: accepted.search.results[0].location_id };
    const expectedWeights = weightsFromPriorities({ ...prioritiesFromWeights(before.weights), water: 50 });
    edit(); fireEvent.change(screen.getByRole("slider", { name: "Water Resilience priority" }), { target: { value: "50" } }); await apply();
    const after = latest("/api/project/converse").output;
    expect(latest("/api/project/converse").input!.source).toBe("filters"); expect(after.project.weights).toEqual(expectedWeights);
    chooseTab(/^What Changed/); await waitFor(() => expect(calls.some((call) => call.pathname === "/api/ranking/diff")).toBe(true));
    const difference = latest("/api/ranking/diff"); expect(difference.input!.before_project).toEqual(before); expect(difference.input!.after_project).toEqual(after.project);
    await screen.findByTestId("ranking-diff");
    for (const row of difference.output.location_deltas) for (const factor of row.factors) expect(document.querySelector(`[data-contribution-delta="${row.location_id}:${factor.factor}"]`)!.textContent).toBe((factor.difference > 0 ? "+" : "") + factor.difference);
    expect([...document.querySelectorAll("[data-map-score]")].map((node) => Number(node.getAttribute("data-map-score")))).toEqual(after.search.results.map((row: RankedLocation) => row.overall_score));
  });
  it("feeds the accepted filter profile into subsequent chat and refreshes the trace", async () => {
    await ready(); const expected = weightsFromPriorities({ ...prioritiesFromWeights(latest("/api/project/converse").output.project.weights), water: 50 });
    edit(); fireEvent.change(screen.getByRole("slider", { name: "Water Resilience priority" }), { target: { value: "50" } }); await apply();
    await send("I need 700 MW instead");
    const request = latest("/api/project/converse"); expect(request.input!.currentProject.weights).toEqual(expected); expect(request.output.project.capacityMw).toBe(700);
    expect(screen.getByText("700 MW")).toBeTruthy();
    const id = request.output.project.selectedLocationId;
    await waitFor(() => expect(latest(`/api/locations/${id}/decision-trace`).input!.project.capacityMw).toBe(700));
  });
  it("increases visible priorities through chat and renders exact constraint transitions", async () => {
    await ready(); const old = latest("/api/project/converse").output.project;
    await send("Water matters much more"); const next = latest("/api/project/converse").output.project;
    expect(next.weights.water).toBeGreaterThan(old.weights.water);
    edit(); expect((screen.getByRole("slider", { name: "Water Resilience priority" }) as HTMLInputElement).value).toBe(String(Math.round(prioritiesFromWeights(next.weights).water))); closeDialog();
    await send("Require fiber coverage at least 90");
    chooseTab(/^What Changed/); await waitFor(() => expect(latest("/api/ranking/diff").output.newly_excluded_count).toBeGreaterThan(0));
    expect(screen.getByTestId("ranking-diff").textContent).toContain("Newly unknown"); expect(screen.getByTestId("ranking-diff").textContent).toContain("Removed requirements");
  });
  it("compares selected counties using the backend's exact directional deltas", async () => {
    await ready(); const second = latest("/api/project/converse").output.search.results[1].location_id;
    fireEvent.click(screen.getByRole("button", { name: "Compare" })); await idle();
    await choose(second); fireEvent.click(screen.getByRole("button", { name: "Compare" })); await idle();
    chooseTab(/^Compare/); await screen.findByTestId("comparison-table");
    const api = latest("/api/compare").output; expect(api.locations).toHaveLength(2);
    expect(screen.getByTestId("pairwise-score").textContent).toContain((api.pairwise[0].score_delta > 0 ? "+" : "") + api.pairwise[0].score_delta);
    for (const factor of api.pairwise[0].factor_deltas) expect(document.querySelector(`[data-pairwise-factor="${factor.factor}"]`)!.textContent).toBe((factor.impact > 0 ? "+" : "") + factor.impact);
  });
  it("saves and reopens the canonical profile, selected county and comparison IDs", async () => {
    await ready(); const second = latest("/api/project/converse").output.search.results[1].location_id;
    await choose(second); fireEvent.click(screen.getByRole("button", { name: "Compare" })); await idle();
    projectSettings(); fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), { target: { value: "Real county review" } });
    save(); await idle(); const saved = latest("/api/projects").output;
    expect(saved.project.selectedLocationId).toBe(second); expect(saved.project.compareLocationIds).toEqual([second]);
    fireEvent.click(screen.getByRole("button", { name: "New project" })); expect(screen.queryByTestId("map-results")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Saved Projects" })); fireEvent.click(await screen.findByRole("button", { name: `Open ${saved.name}` })); await idle();
    projectSettings();
    expect((screen.getByRole("textbox", { name: "Project name" }) as HTMLInputElement).value).toBe(saved.name);
    expect(screen.getByText("Revision 1")).toBeTruthy(); closeDialog();
    fireEvent.click(screen.getByRole("button", { name: "View All Candidates" }));
    await screen.findByText(`${getRanking(saved.project).results.length} ranked candidates`);
    const selected = getRanking(saved.project).results.find((row) => row.location_id === second)!;
    fireEvent.click(screen.getByRole("button", { name: `View ${selected.county_name}, ${selected.state_code}` })); await idle();
    expect((screen.getByRole("combobox", { name: "Selected county" }) as HTMLSelectElement).value).toBe(second);
    expect(screen.getByRole("button", { name: "Compare (1)" })).toBeTruthy();
    expect(latest("/api/locations/search").input!.project).toEqual(saved.project);
    expect(latest(`/api/projects/${saved.id}`).output.project.compareLocationIds).toEqual([second]);
  });
  it("shows accepted chat/filter changes from persisted decision history", async () => {
    await ready(); save(); await idle();
    await send("Water matters much more"); expectRevision(2);
    chooseTab(/^History$/); await screen.findByRole("heading", { name: "Decision History", level: 2 });
    await waitFor(() => expect(document.querySelectorAll("[data-history-revision]")).toHaveLength(2));
    const event = document.querySelector('[data-history-revision="2"]')!;
    expect(event.textContent).toContain("Water matters much more"); expect(event.textContent).toContain("weights.water");
    const savedID = latest("/api/projects").output.id;
    const actual = latest(`/api/projects/${savedID}/history`).output; expect(actual.integrity.valid).toBe(true); expect(actual.events[1].source).toBe("chat");
  });
  it("changes audience language without changing project, ranking, evidence or trace", async () => {
    await ready(); const before = latest("/api/project/converse").output;
    const id = before.search.results[0].location_id; const original = latest(`/api/locations/${id}/decision-trace`).output;
    await screen.findByRole("region", { name: "developer location explanation" });
    expect(calls.some((call) => call.pathname.endsWith("/explain"))).toBe(false);
    await waitFor(() => expect(latest(`/api/locations/${id}/summary`)?.status).toBe(200));
    const originalText = latest(`/api/locations/${id}/summary`).output.summary;
    fireEvent.click(screen.getByRole("button", { name: "community" }));
    await screen.findByRole("region", { name: "community location explanation" });
    expect(document.querySelector(".explanation-tree")).toBeNull();
    await waitFor(() => expect(latest(`/api/locations/${id}/summary`).input!.audience).toBe("community"));
    const response = latest(`/api/locations/${id}/summary`);
    expect(response.output.summary).not.toBe(originalText);
    expect(latest(`/api/locations/${id}/decision-trace`).output).toEqual(original);
    expect(response.input!.project).toEqual({ ...before.project, selectedLocationId: id });
    expect(calls.filter((call) => call.pathname === "/api/project/converse")).toHaveLength(1);
  });
  it("preserves state on revision conflict and provides explicit reload", async () => {
    await ready(); save(); await idle();
    const record = latest("/api/projects").output;
    await project.PATCH(new Request(`http://localhost/api/projects/${record.id}`, { method: "PATCH", body: JSON.stringify({ expected_revision: 1, name: "Changed elsewhere" }) }), { params: Promise.resolve({ id: record.id }) });
    await send("Water matters much more"); expect(screen.getByRole("alert").textContent).toContain("revision changed");
    expectRevision(1); fireEvent.click(screen.getByRole("button", { name: "Reload saved state" })); await idle();
    projectSettings(); expect(screen.getByText("Revision 2")).toBeTruthy(); expect((screen.getByRole("textbox", { name: "Project name" }) as HTMLInputElement).value).toBe("Changed elsewhere");
  });
  it("renders screening limitations without suggesting requested MW is available", async () => {
    await ready(); expect(screen.getAllByText(/does not establish site approval or guaranteed MW/).length).toBeGreaterThan(0);
    expect(document.querySelector(".location-content")!.textContent).toContain("site power availability is not verified");
    const id = latest("/api/project/converse").output.search.results[0].location_id;
    const trace = latest(`/api/locations/${id}/decision-trace`).output as DecisionTrace;
    chooseTab(/^Evidence$/); await waitFor(() => expect(document.querySelectorAll("[data-evidence-id]").length).toBeGreaterThan(0));
    const text = document.querySelector(".dialog-content")!.textContent!;
    for (const warning of trace.warnings) expect(text).toContain(warning);
    expect(text).toContain("capacity feasibility requires utility/interconnection validation");
  });
  it("marks an old snapshot stale, renders current engine results and refreshes only on save", async () => {
    await ready(); const original = latest("/api/project/converse").output.search.results;
    save(); await idle();
    const record = latest("/api/projects").output;
    const database = new DatabaseSync(path.join(directory, "projects.sqlite"));
    database.prepare("UPDATE projects SET snapshot_json = ? WHERE id = ?").run(JSON.stringify({ ...record.last_ranking_snapshot,
      scoring_version: "old-test-scoring", results: record.last_ranking_snapshot.results.map((row: RankedLocation) => ({ ...row, overall_score: 1 })) }), record.id);
    database.close();
    projectSettings(); fireEvent.click(screen.getByRole("button", { name: "Reload saved project" })); await idle();
    expect(screen.getByText("STALE")).toBeTruthy();
    expect([...document.querySelectorAll("[data-map-score]")].map((node) => Number(node.getAttribute("data-map-score")))).toEqual(original.map((row: RankedLocation) => row.overall_score));
    expect(latest(`/api/projects/${record.id}`).output.last_ranking_snapshot.results[0].overall_score).toBe(1);
    save(); await idle(); expect(screen.getByText("CURRENT")).toBeTruthy();
  });
});

describe("chat-first desktop UX", () => {
  it("keeps maps, filters, explanations, quality and service details out of intake", async () => {
    render(<Home />);
    await screen.findByRole("heading", { name: "Where should you build your next AI data center?" });
    expect(document.querySelector("main")!.getAttribute("data-stage")).toBe("intake");
    expect(screen.queryByTestId("map-results")).toBeNull(); expect(screen.queryByRole("slider")).toBeNull();
    expect(document.querySelector(".explanation-tree")).toBeNull(); expect(screen.queryByTestId("comparison-table")).toBeNull();
    expect(document.querySelector("[data-evidence-id]")).toBeNull(); expect(screen.queryByText("Rule-based fallback")).toBeNull();
    expect(screen.queryByText(/Revision \d/)).toBeNull(); expect(screen.queryByText("Decision History")).toBeNull();
    expect(screen.getByText("United States")).toBeTruthy();
  });
  it("asks only missing requirements without asking for country or state", async () => {
    render(<Home />);
    await send("I want to build an AI data center."); expect(latest("/api/project/converse").output.followupQuestion).toMatch(/capacity/i);
    await send("500 MW"); expect(latest("/api/project/converse").output.followupQuestion).toMatch(/training, inference/i);
    await send("AI training"); expect(latest("/api/project/converse").output.followupQuestion).toMatch(/go-live/i);
    await send("2030"); expect(latest("/api/project/converse").output.followupQuestion).toMatch(/priority/i);
    expect(screen.queryByTestId("map-results")).toBeNull();
    await send("Water resilience matters most."); const accepted = latest("/api/project/converse").output;
    expect(accepted.readyToSearch).toBe(true); expect(accepted.project.geography).toEqual({ country: "US", states: [] });
    expect(screen.getByTestId("map-results").children).toHaveLength(20);
    for (const call of calls.filter((call) => call.pathname === "/api/project/converse")) {
      expect(call.input!.currentProject.geography.country).toBe("US");
      expect(call.output.followupQuestion ?? "").not.toMatch(/which country|which state|geography/i);
    }
    expect(screen.getByText("I want to build an AI data center.")).toBeTruthy();
  });
  it("transitions a complete country-free intake into the real map and shortlist", async () => {
    render(<Home />); await send("I need a 500 MW AI training campus by 2030 with strong clean energy and low water risk.");
    const response = latest("/api/project/converse").output;
    expect(response.project.geography.country).toBe("US"); expect(response.readyToSearch).toBe(true);
    expect(response.search.dataMode).toBe("public_data"); expect(document.querySelector("main")!.getAttribute("data-stage")).toBe("workspace");
    expect(screen.getByRole("region", { name: "Ranked candidates" }).querySelectorAll("button")).toHaveLength(5);
    expect(document.querySelector(".selected-workspace")).toBeNull(); expect(document.querySelector(".explanation-tree")).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull(); expect(screen.queryByRole("group", { name: "Explanation audience" })).toBeNull();
    expect(calls.some((call) => call.pathname.endsWith("/decision-trace"))).toBe(false);
  });
  it("applies optional multi-state intake scope and keeps chat and state controls synchronized", async () => {
    render(<Home />); fireEvent.click(screen.getByRole("button", { name: "Choose States" }));
    fireEvent.click(screen.getByRole("radio", { name: "Selected states" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Michigan" })); fireEvent.click(screen.getByRole("checkbox", { name: "Ohio" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply States" })); await idle();
    expect(calls.filter((call) => call.pathname === "/api/project/converse")).toHaveLength(0);
    await send("I need a 500 MW AI training campus by 2030 with low water risk.");
    expect(latest("/api/project/converse").input!.currentProject.geography).toEqual({ country: "US", states: ["MI", "OH"] });
    expect(latest("/api/project/converse").output.search.results.every((row: RankedLocation) => ["MI", "OH"].includes(row.state_code))).toBe(true);
    const manualGeography = latest("/api/project/converse").output.project.geography;
    await send("Only Michigan and Ohio.");
    expect(latest("/api/project/converse").output.project.geography).toEqual(manualGeography);
    await send("Only Michigan."); edit();
    expect((screen.getByRole("checkbox", { name: "Michigan" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Ohio" }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: "Anywhere in U.S." })); await apply();
    expect(latest("/api/project/converse").output.project.geography).toEqual({ country: "US", states: [] });
  });
  it("applies project fields and priorities atomically through the existing filter API", async () => {
    await ready(); const expected = weightsFromPriorities({ ...prioritiesFromWeights(latest("/api/project/converse").output.project.weights), water: 50 }); edit();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Capacity MW" }), { target: { value: "700" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Go-live year" }), { target: { value: "2032" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Workload" }), { target: { value: "AI_INFERENCE" } });
    fireEvent.change(screen.getByRole("slider", { name: "Water Resilience priority" }), { target: { value: "50" } });
    await apply(); const request = latest("/api/project/converse");
    expect(request.input!.source).toBe("filters"); expect(request.output.project.capacityMw).toBe(700);
    expect(request.output.project.targetGoLiveYear).toBe(2032); expect(request.output.project.workloadType).toBe("AI_INFERENCE");
    expect(request.output.project.weights).toEqual(expected); expect(request.output.project.geography.country).toBe("US");
    expect(screen.queryByRole("slider")).toBeNull(); expect(screen.getByRole("region", { name: "Accepted criteria changes" })).toBeTruthy();
  });
  it("cancels criterion drafts without mutating the canonical profile", async () => {
    await ready(); const original = latest("/api/project/converse").output.project;
    edit(); fireEvent.change(screen.getByRole("slider", { name: "Water Resilience priority" }), { target: { value: "50" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Capacity MW" }), { target: { value: "700" } }); closeDialog();
    await send("I need a 2032 go-live instead.");
    expect(latest("/api/project/converse").input!.currentProject.weights).toEqual(original.weights);
    expect(latest("/api/project/converse").input!.currentProject.capacityMw).toBe(500);
  });
  it("keeps ranking diffs lazy and renders the exact backend response on request", async () => {
    await ready(); await send("Cost matters more.");
    expect(screen.getByRole("region", { name: "Accepted criteria changes" })).toBeTruthy();
    expect(calls.some((call) => call.pathname === "/api/ranking/diff")).toBe(false);
    expect(screen.queryByTestId("ranking-diff")).toBeNull();
    chooseTab(/^What Changed/); await waitFor(() => expect(latest("/api/ranking/diff")?.status).toBe(200));
    expect(screen.getByTestId("ranking-diff").textContent).toContain(latest("/api/ranking/diff").output.data_release_id);
  });
  it("keeps a chat Why here summary concise and reveals the exact tree without a duplicate LLM call", async () => {
    await ready(); const count = calls.filter((call) => call.pathname.endsWith("/explain")).length;
    await send("Why here?");
    await screen.findByRole("dialog", { name: "Why this location?" });
    await within(screen.getByRole("dialog")).findByRole("region", { name: "developer location explanation" });
    expect(document.querySelector(".explanation-tree")).toBeNull(); await expand();
    expect(calls.filter((call) => call.pathname.endsWith("/explain"))).toHaveLength(count);
    const response = latest("/api/project/converse").output;
    const actualTrace = latest(`/api/locations/${response.explanationPayload.location.location_id}/decision-trace`).output;
    expect([...document.querySelectorAll("[data-node-id]")].map((node) => node.getAttribute("data-node-id"))).toEqual(flattened(actualTrace));
  });
  it("persists U.S. scope for a legacy saved intake draft before saved chat", async () => {
    const legacy = cloneProject({ capacityMw: 500 }); delete legacy.geography;
    const saved = getProjectRepository().create("Legacy intake", legacy,
      null, { source: "api", interpreted_change: [], ranking_effect_summary: {}, versions: versionsFor(getStoreSnapshot()) });
    window.history.replaceState(null, "", `/?project=${saved.id}`);
    render(<Home />); await waitFor(() => expect(calls.some((call) => call.pathname === `/api/projects/${saved.id}` && call.input?.project?.geography?.country === "US")).toBe(true));
    await idle(); await send("AI training"); await send("2030");
    expect(latest("/api/project/converse").output.followupQuestion).toMatch(/priority/i);
    expect(latest("/api/project/converse").output.project.geography.country).toBe("US");
    expect(latest(`/api/projects/${saved.id}`).output.project.geography.country).toBe("US");
  });
  it("shows a criteria revision conflict inside the drawer and discards its draft on reload", async () => {
    await ready(); save(); await idle(); const record = latest("/api/projects").output;
    await project.PATCH(new Request(`http://localhost/api/projects/${record.id}`, { method: "PATCH", body: JSON.stringify({ expected_revision: 1, project: { capacityMw: 900 } }) }), { params: Promise.resolve({ id: record.id }) });
    edit(); fireEvent.change(screen.getByRole("spinbutton", { name: "Capacity MW" }), { target: { value: "700" } }); await apply();
    expect(within(screen.getByRole("dialog", { name: "Edit Criteria" })).getByRole("alert").textContent).toContain("revision changed");
    fireEvent.click(screen.getByRole("button", { name: "Reload saved state" })); await idle();
    expect(screen.queryByRole("dialog")).toBeNull(); edit();
    expect((screen.getByRole("spinbutton", { name: "Capacity MW" }) as HTMLInputElement).value).toBe("900");
  });
  it("opens actual exclusion evidence when no county passes the initial constraints", async () => {
    render(<Home />); await send("I need a 500 MW AI training campus in Connecticut by 2030 with fiber coverage at least 90.");
    const response = latest("/api/project/converse").output;
    expect(response.search.results).toHaveLength(0);
    expect(response.search.excluded.filter((row: RankedLocation) => row.state_code === "CT")).toHaveLength(9);
    expect(document.querySelector(".selected-workspace")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View All Candidates" }));
    await screen.findByText("No eligible counties under the current criteria."); closeDialog();
    fireEvent.click(screen.getByRole("button", { name: "View Excluded Counties" }));
    await screen.findByText("9 excluded counties");
    const county = response.search.excluded.find((row: RankedLocation) => row.state_code === "CT"), id = county.location_id;
    fireEvent.click(screen.getByRole("button", { name: `View ${county.county_name}, CT` })); await idle();
    await waitFor(() => expect(latest(`/api/locations/${id}/decision-trace`)?.status).toBe(200));
    expect((screen.getByRole("combobox", { name: "Selected county" }) as HTMLSelectElement).value).toBe(id);
    const actual = latest(`/api/locations/${id}/decision-trace`).output;
    expect(actual.feasibility.status).toBe("INSUFFICIENT_DATA"); expect(actual.rank).toBeNull();
    expect(actual.metrics.find((row: { metric: string }) => row.metric === "fiber_coverage_pct").value).toBeNull();
    await screen.findByText("Insufficient Data");
  });
});

describe("All Candidates canonical workspace regression", () => {
  it("opens a dedicated view with the full real rank order, without selecting a county or changing criteria", async () => {
    render(<Home />); await send(intake);
    const canonical = latest("/api/project/converse").output.project, full = getRanking(canonical).results;
    fireEvent.click(screen.getByRole("button", { name: "View All Candidates" }));
    expect(screen.getByRole("dialog", { name: "All Ranked Candidates" })).toBeTruthy();
    await screen.findByText(`${full.length} ranked candidates`);
    expect(candidateRequests.at(-1)).toEqual({ project: canonical, mode: "ranked" });
    expect(document.querySelector(".selected-workspace")).toBeNull();
    expect([...document.querySelectorAll("[data-candidate-id]")].map((node) => node.getAttribute("data-candidate-id"))).toEqual(full.slice(0, 50).map((row) => row.location_id));
    expect(calls.some((call) => call.pathname.endsWith("/decision-trace"))).toBe(false);
  });
  it("selects a real county outside the top 20, closes the dialog and loads current detail while preserving criteria", async () => {
    render(<Home />); await send(intake);
    const before = latest("/api/project/converse").output.project, county = getRanking(before).results.find((row) => row.location_id === "county-26161")!;
    expect(county.rank).toBeGreaterThan(20);
    fireEvent.click(screen.getByRole("button", { name: "View All Candidates" })); await screen.findByText(`${getRanking(before).results.length} ranked candidates`);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search candidates" }), { target: { value: "Washtenaw Michigan" } });
    fireEvent.click(screen.getByRole("button", { name: "View Washtenaw County, MI" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "All Ranked Candidates" })).toBeNull());
    await waitFor(() => expect(latest(`/api/locations/${county.location_id}/decision-trace`)?.status).toBe(200));
    const loaded = latest(`/api/locations/${county.location_id}/decision-trace`);
    expect(loaded.input!.project).toEqual({ ...before, selectedLocationId: county.location_id });
    expect(loaded.output.rank).toBe(county.rank); expect(loaded.output.overall_score).toBe(county.overall_score);
    expect((screen.getByRole("combobox", { name: "Selected county" }) as HTMLSelectElement).value).toBe(county.location_id);
    expect(document.querySelector(".selected-workspace")).toBeTruthy();
    expect(document.activeElement).toBe(document.querySelector(".selected-workspace"));
  });
  it("reloads current saved revisions and respects the accepted state scope after criteria change", async () => {
    await ready(); save(); await idle();
    const first = latest("/api/projects").output;
    fireEvent.click(screen.getByRole("button", { name: "View All Candidates" })); await screen.findByText(`${getRanking(first.project).results.length} ranked candidates`);
    expect(candidateRequests.at(-1)).toEqual({ project: first.project, projectId: first.id, revision: first.revision, mode: "ranked" });
    await send("Only Michigan."); const current = latest("/api/project/converse").output;
    fireEvent.click(screen.getByRole("button", { name: "View All Candidates" })); await screen.findByText(`${getRanking(current.project).results.length} ranked candidates`);
    expect(candidateRequests.at(-1)).toEqual({ project: current.project, projectId: first.id, revision: current.project_record.revision, mode: "ranked" });
    for (const row of document.querySelectorAll("[data-candidate-id]")) expect(row.textContent).toContain(", MI");
  });
  it("shows request failure in the opened view and successfully retries", async () => {
    render(<Home />); await send(intake);
    vi.mocked(candidateActions.loadCandidates).mockResolvedValueOnce({ ok: false, error: "Feature store temporarily unavailable" });
    fireEvent.click(screen.getByRole("button", { name: "View All Candidates" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Feature store temporarily unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText(`${getRanking(latest("/api/project/converse").output.project).results.length} ranked candidates`);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("keeps the dialog and original selection when a saved candidate selection conflicts", async () => {
    await ready(); save(); await idle(); const saved = latest("/api/projects").output;
    fireEvent.click(screen.getByRole("button", { name: "View All Candidates" })); await screen.findByText(`${getRanking(saved.project).results.length} ranked candidates`);
    await project.PATCH(new Request(`http://localhost/api/projects/${saved.id}`, { method: "PATCH", body: JSON.stringify({ expected_revision: saved.revision, project: { capacityMw: 700 } }) }), { params: Promise.resolve({ id: saved.id }) });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search candidates" }), { target: { value: "Washtenaw Michigan" } });
    fireEvent.click(screen.getByRole("button", { name: "View Washtenaw County, MI" })); await idle();
    expect(screen.getByRole("dialog", { name: "All Ranked Candidates" })).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toContain("revision changed");
    expect((screen.getByRole("combobox", { name: "Selected county" }) as HTMLSelectElement).value).toBe(saved.project.selectedLocationId);
  });
});

describe("contextual intake canonical-state regression", () => {
  it.each(["local", "structured"])("accumulates the exact short-answer transcript with current revisions using %s parsing", async (mode) => {
    const model = mode === "structured" ? vi.spyOn(GeminiTransport.prototype, "complete").mockResolvedValue({ capacity_mw: null,
      workload_type: null, target_go_live_year: null, planning_horizon_year: null, geography: null, priority_changes: [],
      constraints_to_add: [], constraints_to_remove: [], action: "update_project", question: "why_here", audience: null,
      clarification: "workload" }) : undefined;
    if (model) { vi.stubEnv("LLM_PROVIDER", "gemini"); vi.stubEnv("LLM_MODEL", "fixture"); vi.stubEnv("GEMINI_API_KEY", "fixture-not-a-real-key"); }
    render(<Home />); projectSettings(); save(); await idle(); closeDialog();
    const saved = latest("/api/projects").output;
    expect(saved.project.geography).toEqual({ country: "US", states: [] });
    let canonical = saved.project, revision = saved.revision;
    const messages = ["hello", "500", "training", "2050", "clean energy and low water risk"];
    const questions = [/capacity/i, /training, inference/i, /go-live year/i, /priority/i];
    const asked: string[] = [];
    for (const [index, message] of messages.entries()) {
      await send(message); const call = latest("/api/project/converse"), response = call.output;
      expect(call.input!.projectId).toBe(saved.id); expect(call.input!.expectedRevision).toBe(revision);
      expect(call.input!.currentProject).toEqual(canonical);
      expect(response.project_record.revision).toBe(revision + 1);
      expect(response.project.geography).toEqual({ country: "US", states: [] });
      expect(response.missingRequiredFields).not.toContain("geography");
      if (index >= 1) expect(response.project.capacityMw).toBe(500);
      if (index >= 2) expect(response.project.workloadType).toBe("AI_TRAINING");
      if (index >= 3) expect(response.project.targetGoLiveYear).toBe(2050);
      if (index < 4) {
        expect(response.followupQuestion).toMatch(questions[index]); asked.push(response.followupQuestion);
        expect(response.search).toBeUndefined(); expect(screen.queryByTestId("map-results")).toBeNull();
      } else {
        expect(response.readyToSearch).toBe(true); expect(response.followupQuestion).toBeNull();
        expect(response.project.activePrioritySignals).toEqual(expect.arrayContaining(["energy", "water"]));
        expect(response.search.dataMode).toBe("public_data");
        expect(response.search.results).toEqual(getRanking(response.project).results.slice(0, 20));
        expect(screen.getByTestId("map-results").children).toHaveLength(20);
      }
      canonical = response.project; revision = response.project_record.revision;
      expect(getProjectRepository().get(saved.id)).toMatchObject({ revision, project: canonical });
    }
    expect(asked).toHaveLength(4); expect(new Set(asked).size).toBe(4);
    expect(asked.join(" ")).not.toMatch(/country|states|region|geography/i);
    expect(getProjectRepository().history(saved.id).events.map((event) => event.revision)).toEqual([1, 2, 3, 4, 5, 6]);
    if (model) {
      expect(model).toHaveBeenCalledTimes(1);
      expect(model.mock.calls[0][1]).toMatchObject({ message: messages.at(-1), currentProject: {
        capacityMw: 500, workloadType: "AI_TRAINING", targetGoLiveYear: 2050, geography: { country: "US", states: [] } } });
    }
  });
  it("keeps the accepted answer and new revision even if the subsequent metadata read fails", async () => {
    render(<Home />); projectSettings(); save(); await idle(); closeDialog();
    const saved = latest("/api/projects").output, originalFetch = fetch;
    let failMetadata = true;
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
      if (url === `/api/projects/${saved.id}` && (!options?.method || options.method === "GET") && failMetadata) {
        failMetadata = false; return Promise.resolve(new Response(JSON.stringify({ error: "Metadata temporarily unavailable" }), { status: 503 }));
      }
      return originalFetch(url, options);
    }));
    await send("500");
    expect(screen.getByRole("alert").textContent).toContain("Metadata temporarily unavailable");
    await send("training"); const next = latest("/api/project/converse");
    expect(next.input!.expectedRevision).toBe(2); expect(next.input!.currentProject.capacityMw).toBe(500);
    expect(next.output.project_record.revision).toBe(3); expect(next.output.project.workloadType).toBe("AI_TRAINING");
    expect(next.output.followupQuestion).toMatch(/go-live year/i);
  });
});
