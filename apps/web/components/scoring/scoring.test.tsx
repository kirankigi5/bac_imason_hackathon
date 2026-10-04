import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ScoringHelp, tutorialStorageKey } from "./ScoringTutorial";
import { FactorHelp } from "./FactorHelp";
import { LocationPerformance } from "./LocationPerformance";
import { CriteriaEditor } from "@/components/filters/CriteriaEditor";
import { TopProfileBar } from "@/components/filters/TopProfileBar";
import { MetricDetails } from "@/components/location/MetricDetails";
import { factorMetadata, capacityHelp, goLiveHelp, locationScore } from "@/lib/frontend/factor-metadata";
import { prioritiesFromWeights, weightsFromPriorities, readPriorities, rememberPriorities, priorityImportance, priorityStorageKey } from "@/lib/frontend/priorities";
import { cloneProject } from "@/lib/project/defaults";
import { categoryKeys, type CategoryKey } from "@/lib/types/domain";
import { getRanking } from "@/lib/backend/decisions";
import { decisionTrace } from "@/lib/decision-engine/decision-trace";
import { evaluateFeasibility } from "@/lib/decision-engine/feasibility";
import { getStoreSnapshot } from "@/lib/data/store";
import { resetBrowserStorage } from "@/test/browser-storage";
import { Dialog } from "@/components/workspace/Dialog";

beforeEach(resetBrowserStorage);
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const project = cloneProject({ capacityMw: 500, workloadType: "AI_TRAINING", targetGoLiveYear: 2050, activePrioritySignals: ["water"] });
const scores = getRanking(project).results[0].category_scores;
const help = () => screen.getByRole("dialog", { name: "How Scoring Works" });
function next() { fireEvent.click(within(help()).getByRole("button", { name: "Next" })); }
function close(title: string) { fireEvent.click(screen.getByRole("button", { name: `Close ${title}` })); }

describe("first-launch scoring tutorial", () => {
  it("appears on first visit, persists Skip, and does not auto-open again", () => {
    const first = render(<ScoringHelp />);
    expect(within(help()).getByText("Step 1 of 4")).toBeTruthy();
    expect(help().textContent).toContain("real U.S. county-level data");
    fireEvent.click(within(help()).getByRole("button", { name: "Skip" }));
    expect(window.localStorage.getItem(tutorialStorageKey)).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull(); first.unmount();
    render(<ScoringHelp />); expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("reopens from persistent help, supports all four steps and returns focus", () => {
    window.localStorage.setItem(tutorialStorageKey, "true"); render(<ScoringHelp />);
    const trigger = screen.getByRole("button", { name: "How scoring works" }); trigger.focus(); fireEvent.click(trigger);
    next(); expect(help().textContent).toContain("Your priority: 0-100");
    expect(help().textContent).toContain("relative weights"); expect(help().textContent).toContain("not percentages");
    for (const factor of ["water", "energy", "economics"] as const) expect(help().textContent).toContain(factorMetadata[factor].display_name);
    next(); expect(help().textContent).toContain("Location score: 0-100");
    expect(help().textContent).toContain("does not mean 92% water availability or an 81% chance of success");
    fireEvent.click(within(help()).getByRole("button", { name: "Back" })); expect(help().textContent).toContain("Step 2 of 4");
    next(); next(); expect(help().textContent).toContain("Hard constraints");
    expect(help().textContent).toContain("Counties below 70 are excluded");
    expect(help().textContent).toContain("maximum raw-risk index");
    fireEvent.click(within(help()).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull(); expect(document.activeElement).toBe(trigger);
  });
  it("persists native Escape/cancel dismissal and restores focus", () => {
    render(<ScoringHelp />); const trigger = screen.getByRole("button", { name: "How scoring works" });
    fireEvent(help(), new Event("cancel", { bubbles: false, cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull(); expect(document.activeElement).toBe(trigger);
    expect(window.localStorage.getItem(tutorialStorageKey)).toBe("true");
  });
  it("continues to work when local browser storage is denied", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("denied"); });
    render(<ScoringHelp />); fireEvent.click(within(help()).getByRole("button", { name: "Skip" }));
    fireEvent.click(screen.getByRole("button", { name: "How scoring works" })); expect(help()).toBeTruthy();
  });
  it("loops keyboard focus between the first and last tutorial controls", () => {
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    render(<ScoringHelp />);
    const first = within(help()).getByRole("button", { name: "Close How Scoring Works" });
    const last = within(help()).getByRole("button", { name: "Next" });
    last.focus(); fireEvent.keyDown(last, { key: "Tab" }); expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true }); expect(document.activeElement).toBe(last);
  });
  it("closes nested factor help on Escape/cancel without closing its parent criteria dialog", () => {
    const closeParent = vi.fn(); render(<Dialog title="Edit Criteria" onClose={closeParent}><FactorHelp factor="water" /></Dialog>);
    const trigger = screen.getByRole("button", { name: "About Water Resilience" }); trigger.focus(); fireEvent.click(trigger);
    fireEvent(screen.getByRole("dialog", { name: "Water Resilience" }), new Event("cancel", { bubbles: true, cancelable: true }));
    expect(screen.queryByRole("dialog", { name: "Water Resilience" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Edit Criteria" })).toBeTruthy(); expect(closeParent).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });
  it("uses an actual supported minimum-score constraint with unchanged feasibility semantics", () => {
    const location = structuredClone(getStoreSnapshot().features[0]);
    const constrained = cloneProject({ constraints: [{ id: "water-resilience-min", metric: "category_scores.water", label: "Minimum water resilience >= 70", operator: ">=", value: 70, kind: "hard" }] });
    location.category_scores.water = 69; expect(evaluateFeasibility(constrained, location).status).toBe("INFEASIBLE");
    location.category_scores.water = 70; expect(evaluateFeasibility(constrained, location).is_feasible).toBe(true);
    location.category_scores.water = null; expect(evaluateFeasibility(constrained, location).status).toBe("INSUFFICIENT_DATA");
  });
});

describe("central factor definitions", () => {
  it.each(categoryKeys)("uses the same %s registry in priorities, scores and evidence help", (factor) => {
    const metadata = factorMetadata[factor];
    render(<FactorHelp factor={factor} />); fireEvent.click(screen.getByRole("button", { name: `About ${metadata.display_name}` }));
    const expected = screen.getByRole("dialog").textContent;
    for (const value of [metadata.priority_meaning, metadata.score_meaning, metadata.score_zero_meaning, metadata.score_hundred_meaning, metadata.source_summary, metadata.proxy_caveat]) expect(expected).toContain(value);
    cleanup(); render(<CriteriaEditor project={project} pending={false} onApply={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: `About ${metadata.display_name}` })); expect(screen.getByRole("dialog").textContent).toBe(expected);
    cleanup(); render(<LocationPerformance scores={scores} />);
    fireEvent.click(screen.getByRole("button", { name: `About ${metadata.display_name}` })); expect(screen.getByRole("dialog").textContent).toBe(expected);
    cleanup(); const metric = decisionTrace(project, "county-46107").metrics.find((row) => metadata.underlying_metrics.includes(row.metric))!;
    expect(metric).toBeTruthy(); render(<MetricDetails metric={metric} />);
    fireEvent.click(screen.getByRole("button", { name: `About ${metadata.display_name}` })); expect(screen.getByRole("dialog").textContent).toBe(expected);
  });
  it("keeps missing approval unavailable without replacing real zero workforce scores", () => {
    render(<LocationPerformance scores={{ ...scores, approval: null, community: 0 }} />);
    const approval = document.querySelector('[data-performance-factor="approval"]')!;
    expect(approval.textContent).toContain("Data unavailable"); expect(approval.textContent).not.toMatch(/\d+\/100/);
    expect(document.querySelector('[data-performance-factor="community"]')!.textContent).toContain("0/100");
    expect(locationScore("approval", 0)).toBe("Data unavailable"); expect(locationScore("water", null)).toBe("Data unavailable");
    fireEvent.click(screen.getByRole("button", { name: "About Workforce & Community Context" }));
    expect(screen.getByRole("dialog").textContent).toContain("does not mean community opposition");
    expect(screen.getByRole("dialog").textContent).toContain("does not measure resident support, community acceptance, or local approval");
  });
  it("uses honest infrastructure, power, capacity and go-live definitions in profile and editor", () => {
    expect(factorMetadata.infrastructure.display_name).toBe("Infrastructure & Connectivity");
    expect(factorMetadata.infrastructure.proxy_caveat).toContain("mass-market broadband availability proxy");
    expect(factorMetadata.energy.proxy_caveat).toContain("does not establish that the requested MW is actually available");
    for (const component of [<TopProfileBar key="profile" project={project} onEdit={() => {}} />, <CriteriaEditor key="editor" project={project} pending={false} onApply={() => {}} />]) {
      render(component); fireEvent.click(screen.getByRole("button", { name: "About Capacity" }));
      expect(screen.getByRole("dialog").textContent).toContain(capacityHelp); close("Capacity");
      fireEvent.click(screen.getByRole("button", { name: "About Go-live year" }));
      expect(screen.getByRole("dialog").textContent).toContain(goLiveHelp); expect(goLiveHelp).toContain("not a future forecast"); cleanup();
    }
  });
});

describe("priority inputs versus location performance", () => {
  it("has independent 0-100 priorities, separate hard constraints and static real scores", async () => {
    const apply = vi.fn(); render(<CriteriaEditor project={project} pending={false} onApply={apply} />);
    const priorities = screen.getByRole("group", { name: "Your Priorities" });
    expect(screen.getByRole("group", { name: "Hard Constraints" })).toBeTruthy();
    const energy = screen.getByRole("slider", { name: "Power & Clean Energy priority" }) as HTMLInputElement;
    const originalEnergy = energy.value;
    fireEvent.change(screen.getByRole("slider", { name: "Water Resilience priority" }), { target: { value: "90" } });
    expect(energy.value).toBe(originalEnergy); expect(priorities.textContent).toContain("Priority: 90/100"); expect(priorities.textContent).not.toContain("%");
    expect(energy.max).toBe("100"); fireEvent.click(screen.getByRole("button", { name: "Apply Criteria" }));
    await waitFor(() => expect(window.localStorage.getItem(priorityStorageKey)).toBeTruthy());
    expect(apply.mock.calls[0][0].weights).toEqual(weightsFromPriorities({ ...prioritiesFromWeights(project.weights), water: 90 }));
    expect(apply.mock.calls[0][0].constraints).toEqual(project.constraints); cleanup();
    render(<LocationPerformance scores={scores} />); expect(screen.queryByRole("slider")).toBeNull();
    for (const factor of categoryKeys) expect(document.querySelector(`[data-performance-factor="${factor}"]`)!.textContent).toContain(locationScore(factor, scores[factor]));
  });
  it("applies untouched criteria without rounding or changing canonical weights", async () => {
    const canonical = cloneProject({ ...project, weights: { energy: .2817, water: .2878, climate: .1174, infrastructure: .1174, economics: .0783, approval: .0783, community: .0391 } });
    const original = JSON.stringify(canonical), apply = vi.fn(); render(<CriteriaEditor project={canonical} pending={false} onApply={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply Criteria" })); await waitFor(() => expect(apply).toHaveBeenCalled());
    expect(apply.mock.calls[0][0]).toEqual(canonical); expect(JSON.stringify(canonical)).toBe(original);
  });
  it("retains entered values locally, rejects malformed scales and falls back to equivalent relative inputs", () => {
    const inputs = { energy: 80, water: 90, climate: 75, infrastructure: 40, economics: 30, approval: 10, community: 50 };
    const weights = weightsFromPriorities(inputs); rememberPriorities(weights, inputs); expect(readPriorities(weights)).toEqual(inputs);
    expect(weights.water / weights.economics).toBeCloseTo(3, 2);
    expect(readPriorities(project.weights)).toEqual(prioritiesFromWeights(project.weights));
    window.localStorage.setItem(priorityStorageKey, JSON.stringify({ weights, priorities: { ...inputs, water: 1000 } }));
    expect(readPriorities(weights)).toEqual(prioritiesFromWeights(weights));
    window.localStorage.setItem(priorityStorageKey, JSON.stringify({ weights, priorities: { ...inputs, water: 0 } }));
    expect(readPriorities(weights)).toEqual(prioritiesFromWeights(weights));
    const ignored = weightsFromPriorities({ ...inputs, water: 0 }); expect(ignored.water).toBe(0);
    expect([0, 25, 50, 75, 90, 100].map(priorityImportance)).toEqual(["Ignore", "Low", "Medium", "High", "Very High", "Highest"]);
    expect(priorityImportance(30)).toBe("Low"); expect(priorityImportance(80)).toBe("High");
  });
  it("prevents all-Ignore inputs without silently restoring default priorities", () => {
    const apply = vi.fn(); render(<CriteriaEditor project={project} pending={false} onApply={apply} />);
    for (const slider of screen.getAllByRole("slider")) fireEvent.change(slider, { target: { value: "0" } });
    expect((screen.getByRole("button", { name: "Apply Criteria" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("At least one priority must be above Ignore");
    expect(apply).not.toHaveBeenCalled();
    expect(() => weightsFromPriorities(Object.fromEntries(categoryKeys.map((factor) => [factor, 0])) as Record<CategoryKey, number>)).toThrow();
  });
  it("does not persist a rejected filter draft", async () => {
    const apply = vi.fn().mockResolvedValue(false); render(<CriteriaEditor project={project} pending={false} onApply={apply} />);
    fireEvent.change(screen.getByRole("slider", { name: "Water Resilience priority" }), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Criteria" })); await waitFor(() => expect(apply).toHaveBeenCalled());
    expect(window.localStorage.getItem(priorityStorageKey)).toBeNull();
  });
});
