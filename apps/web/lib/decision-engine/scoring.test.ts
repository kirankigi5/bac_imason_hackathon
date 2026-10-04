import { describe, expect, it } from "vitest";
import { getDataMode, getEvidenceForLocation, getLocationFeatures } from "@/lib/data/store";
import { cloneProject, defaultProject } from "@/lib/project/defaults";
import { setCategoryWeight } from "@/lib/project/state";
import { categoryKeys, type ProjectState } from "@/lib/types/domain";
import { rankLocations } from "./scoring";

function completeProject(overrides: Partial<ProjectState> = {}): ProjectState {
  return cloneProject({
    ...defaultProject,
    capacityMw: 500,
    workloadType: "AI_TRAINING",
    geography: { country: "US" },
    targetGoLiveYear: 2030,
    activePrioritySignals: ["energy", "water"],
    ...overrides
  });
}

describe("deterministic scoring engine", () => {
  it("ranks the published official features rather than the seed dataset", () => {
    expect(getDataMode()).toBe("public_data");
    const features = getLocationFeatures();
    expect(features.length).toBeGreaterThan(3000);
    const ranked = rankLocations(completeProject(), features).results;
    expect(ranked.length).toBe(20);
    for (const result of ranked) {
      const feature = features.find((item) => item.location_id === result.location_id)!;
      expect(result.category_scores).toEqual(feature.category_scores);
      expect(feature.processing_version).not.toContain("seed");
      expect(result.data_status).not.toBe("estimated");
      expect(getEvidenceForLocation(result.location_id).some((item) => item.raw_sha256 && item.source_url.startsWith("https://"))).toBe(true);
    }
    const kent = features.find((item) => item.location_id === "county-26081")!;
    expect(kent.category_scores.water).not.toBe(88);
    expect(kent.category_scores.approval).toBeNull();
  });

  it("excludes missing categories and normalizes only the available weights", () => {
    const features = getLocationFeatures();
    const kent = features.find((item) => item.location_id === "county-26081")!;
    const ranked = rankLocations(completeProject(), [kent]).results[0];
    expect(ranked.normalized_weights.approval).toBe(0);
    expect(ranked.weighted_contributions.approval).toBe(0);
    expect(categoryKeys.reduce((sum, key) => sum + ranked.normalized_weights[key], 0)).toBeCloseTo(1);
    expect(ranked.feasibility.warnings.join(" ")).toContain("renormalized");
  });

  it("rejects a hard constraint when its required evidence is unavailable", () => {
    const missing = getLocationFeatures().find((item) => item.location_id === "county-09110")!;
    expect(missing.category_scores.infrastructure).toBeNull();
    const ranked = rankLocations(completeProject({
      constraints: [{ id: "fiber", label: "Require fiber", metric: "raw_metrics.fiber_coverage_pct", operator: ">=", value: 90, kind: "hard" }]
    }), [missing]);
    expect(ranked.results).toEqual([]);
    expect(ranked.excluded[0].feasibility.failed_constraints.join(" ")).toContain("evidence is unavailable");
  });

  it("uses real processed FCC fiber for infrastructure scores and hard constraints", () => {
    const features = getLocationFeatures();
    const kent = features.find((row) => row.location_id === "county-26081")!;
    const evidence = getEvidenceForLocation(kent.location_id).find((row) => row.metric_name === "fiber_coverage_pct")!;
    expect(evidence.source_name).toContain("FCC");
    expect(evidence.raw_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.source_filters).toBe("County/Total/B/Fiber");
    expect(kent.raw_metrics.fiber_coverage_pct).toBe(evidence.raw_value);
    expect(kent.category_scores.infrastructure).toBe(evidence.normalized_value);
    expect(kent.category_scores.infrastructure).toBeCloseTo(50.5614484, 5);
    const project = completeProject({ weights: { energy: 0, water: 0, climate: 0, infrastructure: 1, economics: 0, approval: 0, community: 0 },
      constraints: [{ id: "fiber", label: "Require fiber", metric: "raw_metrics.fiber_coverage_pct", operator: ">=", value: 90, kind: "hard" }] });
    const ranked = rankLocations(project, features, features.length);
    expect(ranked.results.length).toBeGreaterThan(0);
    for (const row of ranked.results) {
      expect(row.category_scores.infrastructure).toBeGreaterThanOrEqual(90);
      expect(Number(row.weighted_contributions.infrastructure.toFixed(1))).toBe(row.overall_score);
    }
    expect(ranked.excluded.find((row) => row.location_id === kent.location_id)!.feasibility.failed_constraints).toEqual(["Require fiber"]);
  });

  it("changing a processed measurement changes the deterministic ranking", () => {
    const kent = getLocationFeatures().find((item) => item.location_id === "county-26081")!;
    const project = completeProject({ weights: { energy: 0, water: 1, climate: 0, infrastructure: 0, economics: 0, approval: 0, community: 0 } });
    const better = { ...kent, location_id: "county-01001", county_fips: "01001", category_scores: { ...kent.category_scores, water: 100 } };
    const lower = { ...kent, category_scores: { ...kent.category_scores, water: 20 } };
    expect(rankLocations(project, [lower, better]).results[0].location_id).toBe(better.location_id);
    const improved = { ...lower, category_scores: { ...lower.category_scores, water: 100 } };
    const downgraded = { ...better, category_scores: { ...better.category_scores, water: 0 } };
    expect(rankLocations(project, [improved, downgraded]).results[0].location_id).toBe(kent.location_id);
  });
  it("returns the same ranking for the same input", () => {
    const features = getLocationFeatures();
    const project = completeProject();

    const first = rankLocations(project, features).results.map((location) => location.location_id);
    const second = rankLocations(project, features).results.map((location) => location.location_id);

    expect(second).toEqual(first);
  });

  it("removes candidates that fail hard constraints", () => {
    const features = getLocationFeatures();
    const project = completeProject({
      constraints: [
        {
          id: "drought-risk-max",
          label: "Avoid high drought-risk locations",
          metric: "raw_metrics.drought_risk_index",
          operator: "<=",
          value: 60,
          kind: "hard"
        }
      ]
    });

    const ranked = rankLocations(project, features, 100);
    expect(ranked.excluded.some((location) => location.location_id === "county-04013")).toBe(true);
    expect(ranked.results.some((location) => location.location_id === "county-04013")).toBe(false);
  });

  it("increasing water weight increases direct water contribution for a location", () => {
    const features = getLocationFeatures();
    const baseProject = completeProject();
    const waterHeavyProject = completeProject({
      weights: setCategoryWeight(baseProject.weights, "water", 0.35)
    });

    const baseKent = rankLocations(baseProject, features, features.length).results.find((location) => location.location_id === "county-26081");
    const waterKent = rankLocations(waterHeavyProject, features, features.length).results.find((location) => location.location_id === "county-26081");

    expect(baseKent).toBeDefined();
    expect(waterKent).toBeDefined();
    expect(waterKent!.weighted_contributions.water).toBeGreaterThan(baseKent!.weighted_contributions.water);
  });
});
