import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { decisionTrace } from "@/lib/decision-engine/decision-trace";
import { cloneProject } from "@/lib/project/defaults";
import { buildLocationSummary } from "@/lib/frontend/location-summary";
import { buildSummaryFacts, renderSummary } from "@/lib/llm/location-summary";
import type { Audience } from "@/lib/types/domain";
import { LocationSummary } from "./LocationSummary";

afterEach(cleanup);
const project = cloneProject({ capacityMw: 550, workloadType: "MIXED", targetGoLiveYear: 2045, activePrioritySignals: ["energy", "water"] });
const potter = decisionTrace(project, "county-46107"), modes: Audience[] = ["developer", "government", "community"];
describe("selected-location primary explanation", () => {
  it.each(modes)("keeps %s prose at 50-80 words, above human-readable scores and risks", (audience) => {
    render(<LocationSummary trace={potter} project={project} audience={audience} label="Potter County, SD" />);
    const main = screen.getByTestId("main-location-explanation"), text = main.textContent!, words = text.trim().split(/\s+/).length;
    expect(words).toBeGreaterThanOrEqual(50); expect(words).toBeLessThanOrEqual(80);
    expect(main.previousElementSibling!.querySelector("h2")!.textContent).toBe("Potter County, SD");
    expect(main.nextElementSibling!.querySelector("h3")!.textContent).toBe("Top strengths");
    expect(document.querySelector("[data-feasibility-status]")!.getAttribute("data-feasibility-status")).toBe(potter.feasibility.status);
    expect(screen.getByText("Conditionally Feasible")).toBeTruthy(); expect(screen.getByText(`#${potter.rank}`)).toBeTruthy();
    expect(document.querySelectorAll("[data-summary-strength]")).toHaveLength(3); expect(document.querySelectorAll("[data-summary-risk]")).toHaveLength(3);
    for (const row of potter.positive_drivers) expect(document.querySelector(`[data-summary-strength="${row.factor}"] strong`)!.textContent).toBe(`${Number(row.score.toFixed(1))}/100`);
    expect(screen.getByText("550 MW site power availability is not verified")).toBeTruthy();
    expect(screen.getByText("Local approval is not documented")).toBeTruthy(); expect(screen.getByText("Dedicated data-center fiber requires validation")).toBeTruthy();
    expect(screen.getByText("View all risks").parentElement!.hasAttribute("open")).toBe(false);
    for (const hidden of [potter.data_release_id, potter.scoring_version, potter.normalization_version, ...potter.warnings,
      ...potter.metrics.flatMap((metric) => [metric.source, metric.caveat, metric.raw_sha256]).filter(Boolean) as string[]]) expect(screen.getByTestId("location-summary").textContent).not.toContain(hidden);
    expect(screen.getByTestId("location-summary").textContent).not.toMatch(/county-\d{5}|weighted contribution|effective weight|EPSG|SHA-256|\/100; \+/);
  });
  it("retains identical facts for all audiences without mutating records", () => {
    const before = JSON.stringify({ potter, project }), facts = buildSummaryFacts(potter, project, "Potter County", "SD");
    const summaries = modes.map((audience) => renderSummary(facts, audience));
    expect(new Set(summaries).size).toBe(3); expect(JSON.stringify({ potter, project })).toBe(before);
    expect(buildLocationSummary(potter, project).allRisks.find((risk) => risk.id === "weak:community")!.text).toContain("0.0/100");
  });
  it.each(["FEASIBLE", "CONDITIONALLY_FEASIBLE", "INSUFFICIENT_DATA", "INFEASIBLE"] as const)("retains %s without claiming a failed county is recommended", (status) => {
    const trace = structuredClone(potter); trace.feasibility.status = status;
    trace.rank = ["INFEASIBLE", "INSUFFICIENT_DATA"].includes(status) ? null : potter.rank;
    render(<LocationSummary trace={trace} project={project} audience="community" label="Potter County, SD" />);
    expect(document.querySelector("[data-feasibility-status]")!.getAttribute("data-feasibility-status")).toBe(status);
    const text = screen.getByTestId("main-location-explanation").textContent!;
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(80);
    if (trace.rank === null) { expect(screen.getByText("Excluded")).toBeTruthy(); expect(text).toMatch(/excluded|cannot currently be qualified/); }
  });
  it("preserves missing Connecticut fiber and prioritizes its required-evidence risk", () => {
    const current = cloneProject({ ...project, geography: { country: "US", states: ["CT"] }, constraints: [
      { id: "fiber-min", label: "Fiber >= 90", metric: "raw_metrics.fiber_coverage_pct", operator: ">=", value: 90, kind: "hard" }
    ] });
    const trace = decisionTrace(current, "county-09110");
    render(<LocationSummary trace={trace} project={current} audience="developer" label="Capitol Planning Region, CT" />);
    expect(buildLocationSummary(trace, current).risks[0].text).toBe("Fiber coverage required evidence missing");
    expect(screen.getByTestId("main-location-explanation").textContent).toContain("cannot currently be qualified");
    expect(trace.metrics.find((row) => row.metric === "fiber_coverage_pct")!.value).toBeNull();
  });
  it("does not fill absent strengths or risks with fabricated values", () => {
    const trace = structuredClone(potter);
    trace.positive_drivers = []; trace.negative_drivers = []; trace.feasibility.checks = [];
    trace.major_missing_evidence = []; trace.missing_metrics = []; trace.metrics = [];
    render(<LocationSummary trace={trace} project={project} audience="developer" label="Potter County, SD" />);
    expect(document.querySelectorAll("[data-summary-strength], [data-summary-risk]")).toHaveLength(0);
  });
  it.each(["county-26081", "county-06037", "county-48201", "county-09110", "county-36061", "county-12086"])("bounds the actual real-county %s fallback across all audiences", (id) => {
    const trace = decisionTrace(project, id);
    for (const audience of modes) {
      const text = renderSummary(buildSummaryFacts(trace, project, "Real county result", "US"), audience);
      expect(text.split(/\s+/).length).toBeGreaterThanOrEqual(50); expect(text.split(/\s+/).length).toBeLessThanOrEqual(80);
    }
  });
});
