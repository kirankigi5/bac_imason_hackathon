import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FeasibilityStatus } from "./FeasibilityStatus";
import { MetricDetails } from "./MetricDetails";
import { ExplanationTree } from "./ExplanationTree";
import { decisionTrace } from "@/lib/decision-engine/decision-trace";
import { cloneProject } from "@/lib/project/defaults";

afterEach(cleanup);
describe("feasibility and missing evidence presentation", () => {
  it.each(["FEASIBLE", "CONDITIONALLY_FEASIBLE", "INSUFFICIENT_DATA", "INFEASIBLE"] as const)("preserves backend status %s", (status) => {
    render(<FeasibilityStatus status={status} description />);
    expect(screen.getByText(status)).toBeTruthy(); expect(document.querySelector("[data-feasibility-status]")!.getAttribute("data-feasibility-status")).toBe(status);
  });
  it("keeps unmatched Connecticut fiber missing, with its actual provenance and quality", () => {
    const project = cloneProject({ capacityMw: 500, workloadType: "AI_TRAINING", geography: { country: "US", states: ["CT"] }, targetGoLiveYear: 2030,
      constraints: [{ id: "fiber-min", label: "Minimum fiber coverage >= 90", metric: "raw_metrics.fiber_coverage_pct", operator: ">=", value: 90, kind: "hard" }] });
    const trace = decisionTrace(project, "county-09110"), metric = trace.metrics.find((row) => row.metric === "fiber_coverage_pct")!;
    render(<MetricDetails metric={metric} />);
    expect(metric.value).toBeNull(); expect(metric.metric_type).toBe("missing");
    expect(document.querySelector("[data-raw-value]")!.getAttribute("data-raw-value")).toBe("missing"); expect(screen.getByText("Missing")).toBeTruthy(); expect(screen.getByText("Data unavailable")).toBeTruthy();
    cleanup(); render(<ExplanationTree trace={trace} project={project} onSelect={() => undefined} />);
    expect(trace.rank).toBeNull(); expect(screen.getByText(trace.explanation_graph.root.label)).toBeTruthy();
    expect(document.querySelector('[data-node-id="missing:fiber_coverage_pct"]')).toBeTruthy();
  });
});
