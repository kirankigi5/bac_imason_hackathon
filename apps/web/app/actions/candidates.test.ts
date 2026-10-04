import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCandidates } from "./candidates";
import { cloneProject } from "@/lib/project/defaults";
import { getRanking } from "@/lib/backend/decisions";
import { createProject, updateProject } from "@/lib/project/persistence";
import { closeProjectRepository, getProjectRepository } from "@/lib/project/repository";

const project = cloneProject({ capacityMw: 500, workloadType: "AI_TRAINING", targetGoLiveYear: 2030, activePrioritySignals: ["water", "energy"] });
let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "all-candidates-")); vi.stubEnv("PROJECT_DB_PATH", path.join(directory, "projects.sqlite")); });
afterEach(() => { closeProjectRepository(); vi.unstubAllEnvs(); fs.rmSync(directory, { recursive: true, force: true }); });

describe("read-only complete candidate ranking", () => {
  it("returns the entire real backend ranking, not just its top 20, without changing the project", async () => {
    const original = JSON.stringify(project), result = await loadCandidates({ project, mode: "ranked" });
    expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.error);
    expect(result.data.results).toEqual(getRanking(project).results); expect(result.data.results.length).toBeGreaterThan(20);
    expect(result.data.results.every((row, index) => row.rank === index + 1 && row.feasibility.is_feasible)).toBe(true);
    expect(result.data.results.some((row) => row.location_id === "county-26081")).toBe(true);
    expect(JSON.stringify(project)).toBe(original);
  });
  it("uses the complete canonical fields and current saved revision without writing history or snapshots", async () => {
    const scoped = cloneProject({ ...project, capacityMw: 700, workloadType: "AI_INFERENCE", targetGoLiveYear: 2050,
      geography: { country: "US", states: ["MI"] }, weights: { energy: .2, water: .4, climate: .15, infrastructure: .1, economics: .05, approval: .05, community: .05 },
      constraints: [{ id: "water-resilience-min", label: "Minimum water resilience >= 50", metric: "category_scores.water", operator: ">=", value: 50, kind: "hard" }] });
    const saved = createProject("Michigan canonical project", scoped);
    const before = getProjectRepository().get(saved.id), history = getProjectRepository().history(saved.id);
    const response = await loadCandidates({ project: saved.project, projectId: saved.id, revision: saved.revision, mode: "ranked" });
    expect(response.ok).toBe(true); if (!response.ok) throw new Error(response.error);
    expect(response.data.results).toEqual(getRanking(saved.project).results);
    expect(response.data.results.every((row) => row.state_code === "MI" && row.category_scores.water! >= 50)).toBe(true);
    expect(getProjectRepository().get(saved.id)).toEqual(before); expect(getProjectRepository().history(saved.id)).toEqual(history);
  });
  it("rejects outdated revisions and noncanonical saved criteria", async () => {
    const saved = createProject("Revision test", project);
    const changed = await loadCandidates({ project: cloneProject({ ...saved.project, capacityMw: 700 }), projectId: saved.id, revision: saved.revision, mode: "ranked" });
    expect(changed).toMatchObject({ ok: false, error: expect.stringContaining("criteria changed") });
    updateProject(saved.id, saved.revision, { targetGoLiveYear: 2050 });
    expect(await loadCandidates({ project: saved.project, projectId: saved.id, revision: saved.revision, mode: "ranked" })).toMatchObject({ ok: false, error: expect.stringContaining("revision") });
  });
  it("keeps excluded counties separate and scoped to the current project", async () => {
    const current = cloneProject({ ...project, geography: { country: "US", states: ["CT"] }, constraints: [{ id: "fiber-min", label: "Minimum fiber coverage >= 90", metric: "raw_metrics.fiber_coverage_pct", operator: ">=", value: 90, kind: "hard" }] });
    const eligible = await loadCandidates({ project: current, mode: "ranked" }), excluded = await loadCandidates({ project: current, mode: "excluded" });
    expect(eligible.ok && eligible.data.results).toEqual([]); expect(excluded.ok && excluded.data.results).toHaveLength(9);
    if (excluded.ok) expect(excluded.data.results.every((row) => row.state_code === "CT" && !row.feasibility.is_feasible && row.feasibility.status === "INSUFFICIENT_DATA")).toBe(true);
  });
  it("returns visible validation errors rather than hiding incomplete or invalid requests", async () => {
    expect(await loadCandidates({ project: cloneProject(), mode: "ranked" })).toMatchObject({ ok: false, error: expect.stringContaining("Complete") });
    expect(await loadCandidates({ project, revision: 1, mode: "ranked" })).toMatchObject({ ok: false, error: expect.stringContaining("Invalid") });
  });
  it("reports a real feature-store read failure without fabricating a list", async () => {
    vi.stubEnv("DATA_DIR", path.join(directory, "missing-feature-store"));
    expect(await loadCandidates({ project, mode: "ranked" })).toEqual({ ok: false, error: "Could not load candidates from the feature store. Please retry." });
  });
});
