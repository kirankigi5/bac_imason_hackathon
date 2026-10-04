import { describe, expect, it } from "vitest";
import { getEvidenceForLocation, getLocationFeatures, getStoreSnapshot } from "@/lib/data/store";
import { cloneProject } from "@/lib/project/defaults";
import { buildExplanationPayload, explainFromPayload } from "./explanations";
import { rankLocations } from "./scoring";

describe("official feature explanations", () => {
  it("grounds numeric driver claims in the selected release's source evidence", () => {
    const snapshot = getStoreSnapshot();
    const features = getLocationFeatures(snapshot);
    const project = cloneProject({ capacityMw: 500, geography: { country: "US" } });
    const ranking = rankLocations(project, features, features.length);
    const kent = ranking.results.find((row) => row.location_id === "county-26081")!;
    const evidence = getEvidenceForLocation(kent.location_id, snapshot);
    const payload = buildExplanationPayload(project, kent, evidence, ranking.results);
    const explanation = explainFromPayload(payload, "developer");
    expect(explanation).toContain("WRI Aqueduct");
    expect(explanation).not.toContain("Seeded demo");
    expect(explanation).toContain("Power readiness is unavailable");
    expect(explanation).not.toMatch(/500 MW (is |definitely )?available/i);
    expect(evidence.every((row) => row.status !== "estimated")).toBe(true);
    for (const driver of payload.topPositiveContributions) {
      expect(driver.score).toBe(kent.category_scores[driver.factor]);
    }
  });

  it("exposes uncertainty without claiming approval or resident support", () => {
    const features = getLocationFeatures();
    const project = cloneProject();
    const ranking = rankLocations(project, features);
    const selected = ranking.results[0];
    const payload = buildExplanationPayload(project, selected, getEvidenceForLocation(selected.location_id), ranking.results);
    const explanation = explainFromPayload(payload, "community");
    expect(explanation).toContain("does not claim community approval");
    expect(explanation).not.toMatch(/\d+% of residents/);
    expect(payload.caveats.join(" ")).toContain("missing metrics");
    expect(explanation).toContain("labor-pool context only, not community acceptance or local approval");
    expect(explanation).toContain("do not establish site-specific supply or tariffs");
  });
});
