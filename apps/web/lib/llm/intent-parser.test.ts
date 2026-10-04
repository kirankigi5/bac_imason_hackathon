import { describe, expect, it } from "vitest";
import { defaultProject } from "@/lib/project/defaults";
import { parseProjectIntent } from "./intent-parser";

describe("intent parser", () => {
  it("extracts the complete MVP demo prompt", () => {
    const result = parseProjectIntent(
      "I need a 500 MW AI training facility in the US by 2030 with low water risk and strong clean energy.",
      defaultProject
    );

    expect(result.readyToSearch).toBe(true);
    expect(result.project.capacityMw).toBe(500);
    expect(result.project.workloadType).toBe("AI_TRAINING");
    expect(result.project.targetGoLiveYear).toBe(2030);
    expect(result.project.geography).toEqual({ country: "US", states: [] });
    expect(result.project.activePrioritySignals).toContain("water");
    expect(result.project.activePrioritySignals).toContain("energy");
  });

  it("asks the highest-value follow-up question for incomplete prompts", () => {
    const result = parseProjectIntent("I want to build an AI data center in the US.", defaultProject);

    expect(result.readyToSearch).toBe(false);
    expect(result.missingRequiredFields[0]).toBe("capacity");
    expect(result.followupQuestion).toMatch(/capacity/i);
  });

  it("turns wildfire avoidance into a hard constraint", () => {
    const result = parseProjectIntent("Avoid high wildfire risk.", defaultProject);

    expect(result.project.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "wildfire-risk-max",
          metric: "raw_metrics.wildfire_risk_index",
          operator: "<="
        })
      ])
    );
  });
});
