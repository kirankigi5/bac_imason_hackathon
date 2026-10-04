// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEvidenceForLocation, getStoreSnapshot } from "@/lib/data/store";
import { decisionTrace } from "@/lib/decision-engine/decision-trace";
import { evaluateFeasibility } from "@/lib/decision-engine/feasibility";
import { metricQuality } from "@/lib/decision-engine/metric-quality";
import { rankLocations } from "@/lib/decision-engine/scoring";
import { cloneProject } from "@/lib/project/defaults";
import { setCategoryWeight } from "@/lib/project/state";
import { projectSchema } from "@/lib/llm/schemas";
import { categoryKeys, type ExplanationNode, type ProjectState } from "@/lib/types/domain";
import { GET as traceGET, POST as tracePOST } from "@/app/api/locations/[locationId]/decision-trace/route";
import { POST as comparePOST } from "@/app/api/compare/route";
import { POST as diffPOST } from "@/app/api/ranking/diff/route";
import { canonicalJSON, DecisionCache, decisionCache, stableHash } from "./cache";
import { getRanking, rankingKey, versionsFor } from "./decisions";
import { rankingDiff } from "./ranking-diff";
import { comparison } from "./comparison";

const snapshot = getStoreSnapshot();
const kent = "county-26081", ct = "county-09110";
const project = (overrides: Partial<ProjectState> = {}) => cloneProject({ capacityMw: 500,
  workloadType: "AI_TRAINING", geography: { country: "US" }, targetGoLiveYear: 2030,
  activePrioritySignals: ["water"], ...overrides });
const fiber = (value: number) => ({ id: "fiber-min", label: "Fiber screening minimum", metric: "raw_metrics.fiber_coverage_pct",
  operator: ">=" as const, value, kind: "hard" as const });
const request = (body: unknown) => new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) });
function nodes(root: ExplanationNode): ExplanationNode[] { return [root, ...(root.children ?? []).flatMap(nodes)]; }
beforeEach(() => decisionCache.clear());

describe("versioned real-data decision backend", () => {
  it("returns deterministic ranking versions and real feature quality counts", () => {
    const a = getRanking(project()), b = getRanking(project());
    expect(a).toEqual(b); expect(a.data_release_id).toBe(snapshot.manifest.store_path!.split("/").at(-1));
    expect(a.scoring_version).toMatch(/^county-screening-/); expect(a.normalization_version).toMatch(/^county-normalization-/);
    expect(decisionCache.stats().hits).toBe(1);
    const row = a.results.find((item) => item.location_id === kent)!;
    const feature = snapshot.features.find((item) => item.location_id === kent)!;
    expect(row.category_scores).toEqual(feature.category_scores);
    expect(row.available_ranking_metrics + row.missing_ranking_metrics).toBe(Object.keys(feature.normalized_metrics!).length);
    expect(row.confidence_label).toBe("SCREENING_ONLY");
    expect(row.major_missing_evidence).toContain("utility_interconnection_approval");
    expect(row.major_missing_evidence).toContain("community_acceptance");
  });
  it("separates cache keys by all versions, weights and constraints", () => {
    const p = project(), versions = versionsFor(snapshot), key = rankingKey(p, versions);
    for (const field of ["data_release_id", "scoring_version", "normalization_version"] as const)
      expect(rankingKey(p, { ...versions, [field]: versions[field] + "-new" })).not.toBe(key);
    expect(rankingKey(project({ constraints: [fiber(90)] }), versions)).not.toBe(key);
    expect(rankingKey(project({ weights: setCategoryWeight(p.weights, "water", .5) }), versions)).not.toBe(key);
    const next = getRanking(p, { ...snapshot, manifest: { ...snapshot.manifest, store_path: "releases/11111111111111111111" } });
    expect(next.data_release_id).not.toBe(versions.data_release_id); expect(decisionCache.stats().misses).toBe(1);
  });
  it("canonicalizes object order and bounds isolated LRU cache entries", () => {
    expect(stableHash({ b: 2, a: { z: 1, y: 3 } })).toBe(stableHash({ a: { y: 3, z: 1 }, b: 2 }));
    expect(() => canonicalJSON({ score: NaN })).toThrow();
    const cache = new DecisionCache(2, 200), compute = vi.fn(() => ({ values: [1] }));
    cache.remember("a", compute).values.push(2);
    expect(cache.remember("a", compute)).toEqual({ values: [1] });
    cache.remember("b", compute); cache.remember("a", compute); cache.remember("c", compute);
    cache.remember("b", compute);
    expect(compute).toHaveBeenCalledTimes(4); expect(cache.stats().entries).toBe(2);
    cache.remember("too-large", () => "x".repeat(300)); expect(cache.stats().bytes).toBeLessThanOrEqual(200);
  });
  it("isolates returned ranking mutations from cached decisions", () => {
    const a = getRanking(project()); a.results[0].overall_score = -99;
    expect(getRanking(project()).results[0].overall_score).toBeGreaterThan(0);
  });
  it("supports all four statuses without treating unknown evidence as measured failure", () => {
    const real = snapshot.features.find((row) => row.location_id === kent)!;
    const complete = { ...real, category_scores: Object.fromEntries(categoryKeys.map((key) => [key, 80])) as typeof real.category_scores };
    expect(evaluateFeasibility(project({ capacityMw: undefined }), complete).status).toBe("FEASIBLE");
    expect(evaluateFeasibility(project(), real).status).toBe("CONDITIONALLY_FEASIBLE");
    expect(evaluateFeasibility(project({ constraints: [fiber(90)] }), real).status).toBe("INFEASIBLE");
    const missing = snapshot.features.find((row) => row.location_id === ct)!;
    const unknown = evaluateFeasibility(project({ constraints: [fiber(90)] }), missing);
    expect(unknown.status).toBe("INSUFFICIENT_DATA"); expect(unknown.is_feasible).toBe(false);
    expect(unknown.checks.find((check) => check.id === "fiber-min")?.status).toBe("UNKNOWN");
    expect(unknown.reasons.join(" ")).toContain("unavailable");
    const noMetrics = { ...real, category_scores: Object.fromEntries(categoryKeys.map((key) => [key, null])) as typeof real.category_scores };
    expect(rankLocations(project(), [noMetrics]).excluded[0].feasibility.status).toBe("INSUFFICIENT_DATA");
  });
  it("builds trace drivers and a deterministic graph from exact contributions and evidence", () => {
    const p = project(), trace = decisionTrace(p, kent), row = getRanking(p).results.find((item) => item.location_id === kent)!;
    const expected = categoryKeys.filter((key) => row.category_scores[key] !== null && row.normalized_weights[key] > 0)
      .sort((a, b) => row.weighted_contributions[b] - row.weighted_contributions[a] || a.localeCompare(b)).slice(0, 3);
    expect(trace.positive_drivers.map((driver) => driver.factor)).toEqual(expected);
    const evidenceIds = new Set(trace.evidence.map((item) => item.evidence_id));
    for (const driver of [...trace.positive_drivers, ...trace.negative_drivers]) {
      expect(driver.contribution).toBe(row.weighted_contributions[driver.factor]);
      expect(driver.weight).toBe(row.normalized_weights[driver.factor]);
      expect(driver.source_refs.length).toBeGreaterThan(0);
      for (const ref of driver.source_refs) expect(evidenceIds.has(ref)).toBe(true);
    }
    expect(trace.negative_drivers.every((driver) => driver.score < 65 && driver.contribution >= 0)).toBe(true);
    const graph = nodes(trace.explanation_graph.root);
    expect(new Set(graph.map((node) => node.id)).size).toBe(graph.length);
    for (const node of graph) for (const ref of node.source_refs ?? []) expect(evidenceIds.has(ref)).toBe(true);
    expect(trace.evidence.map(({ evidence_id: _id, ...item }) => item)).toEqual(getEvidenceForLocation(kent));
    expect(decisionTrace(p, kent)).toEqual(trace);
    for (const alt of trace.alternatives) expect(alt.factor_deltas.reduce((sum, item) => sum + item.impact, 0) + alt.rounding_delta).toBeCloseTo(alt.score_delta);
  });
  it("exposes missing fiber, provenance, dated proxies and no invented site confidence", () => {
    const trace = decisionTrace(project({ constraints: [fiber(90)] }), ct);
    expect(trace.rank).toBeNull(); expect(trace.missing_metrics).toContain("fiber_coverage_pct");
    const missing = trace.metrics.find((row) => row.metric === "fiber_coverage_pct")!;
    expect(missing.value).toBeNull(); expect(missing.score).toBeNull(); expect(missing.metric_type).toBe("missing");
    expect(missing.confidence).toBe("MISSING"); expect(missing.status).toBe("missing");
    const fcc = decisionTrace(project(), kent).metrics.find((row) => row.metric === "fiber_coverage_pct")!;
    expect(fcc.metric_type).toBe("proxy"); expect(fcc.source_year).toBe(2025); expect(fcc.source_as_of).toBe("2025-12-31");
    expect(fcc.caveat).toMatch(/not.*dedicated/i); expect(fcc.raw_sha256).toMatch(/^[a-f0-9]{64}$/);
    for (const row of trace.metrics) for (const field of ["value", "score", "unit", "source", "source_year", "metric_type", "confidence", "status", "caveat"])
      expect(row).toHaveProperty(field);
    const evidence = getEvidenceForLocation(kent).find((row) => row.raw_value !== null)!;
    expect(metricQuality({ ...evidence, status: "stale" }).confidence).toBe("STALE_SOURCE");
    expect(metricQuality({ ...evidence, status: "estimated" }).metric_type).toBe("estimated");
  });
  it("computes exact before/after ranks, contributions, weights and top-N transitions", () => {
    const before = project(), after = project({ weights: setCategoryWeight(before.weights, "water", .6) });
    const diff = rankingDiff(before, after, [kent], 10), a = getRanking(before), b = getRanking(after);
    expect(diff.changes).toContainEqual({ field: "weights.water", old_value: before.weights.water, new_value: after.weights.water });
    const delta = diff.location_deltas.find((row) => row.location_id === kent)!;
    const old = a.results.find((row) => row.location_id === kent)!, next = b.results.find((row) => row.location_id === kent)!;
    expect(delta.old_rank).toBe(old.rank); expect(delta.new_rank).toBe(next.rank);
    expect(delta.old_score).toBe(old.overall_score); expect(delta.new_score).toBe(next.overall_score);
    for (const key of categoryKeys) expect(delta.contribution_deltas[key]).toBeCloseTo(next.weighted_contributions[key] - old.weighted_contributions[key]);
    const oldIds = a.results.slice(0, 10).map((row) => row.location_id), newIds = b.results.slice(0, 10).map((row) => row.location_id);
    expect(diff.entering_top_n).toEqual(newIds.filter((id) => !oldIds.includes(id)));
    expect(diff.leaving_top_n).toEqual(oldIds.filter((id) => !newIds.includes(id)));
    expect(diff.entering_top_n.length).toBeGreaterThan(0); expect(rankingDiff(before, after, [kent], 10)).toEqual(diff);
  });
  it("separates constraint failures, missing evidence, passing changes and removal", () => {
    const before = project(), strict = project({ constraints: [fiber(90)] });
    const diff = rankingDiff(before, strict, [kent, ct]);
    const failed = diff.location_deltas.find((row) => row.location_id === kent)!;
    const unknown = diff.location_deltas.find((row) => row.location_id === ct)!;
    expect(failed.newly_failed_constraints).toContain("fiber-min"); expect(failed.new_rank).toBeNull();
    expect(unknown.newly_failed_constraints).not.toContain("fiber-min"); expect(unknown.newly_unknown_constraints).toContain("fiber-min");
    const relaxed = project({ constraints: [fiber(0)] });
    expect(rankingDiff(strict, relaxed, [kent]).location_deltas.find((row) => row.location_id === kent)!.newly_passed_constraints).toContain("fiber-min");
    const removed = rankingDiff(strict, before, [kent]).location_deltas.find((row) => row.location_id === kent)!;
    expect(removed.removed_constraints).toContain("fiber-min"); expect(removed.newly_passed_constraints).not.toContain("fiber-min");
  });
  it("does not reuse a diff for distinct selection-only project updates", () => {
    const before = project();
    const one = rankingDiff(before, project({ selectedLocationId: kent }));
    const two = rankingDiff(before, project({ selectedLocationId: ct }));
    expect(one.after_project_hash).toBe(two.after_project_hash);
    expect(two.changes).toContainEqual({ field: "selectedLocationId", old_value: null, new_value: ct });
    expect(two.changes).not.toEqual(one.changes);
  });
  it("returns directional pairwise differences that reproduce displayed score deltas", () => {
    const p = project(), ids = [kent, "county-04013", ct], result = comparison(p, ids);
    expect(result.pairwise).toHaveLength(3);
    for (const pair of result.pairwise) {
      const [a, b] = pair.pair.map((id) => result.locations.find((row) => row.location_id === id)!);
      expect(pair.score_delta).toBeCloseTo(a.overall_score - b.overall_score);
      for (const row of pair.factor_deltas) expect(row.impact).toBeCloseTo(a.weighted_contributions[row.factor] - b.weighted_contributions[row.factor]);
      expect(pair.factor_deltas.reduce((sum, row) => sum + row.impact, 0) + pair.rounding_delta).toBeCloseTo(pair.score_delta);
      if (pair.top_advantage) expect(pair.top_advantage.impact).toBeGreaterThan(0);
      if (pair.top_disadvantage) expect(pair.top_disadvantage.impact).toBeLessThan(0);
    }
    expect(result.locations.every((row) => Object.keys(row.raw_values).length > 0 && row.metric_quality.length > 0)).toBe(true);
    expect(comparison(p, ids)).toEqual(result);
    const reversed = comparison(p, [ids[1], ids[0]]).pairwise[0];
    expect(reversed.score_delta).toBeCloseTo(-result.pairwise[0].score_delta);
  });
  it("does not recommend excluded counties or quietly ignore unknown IDs", () => {
    const p = project({ constraints: [fiber(90)] }), ranking = getRanking(p);
    const good = ranking.results[0].location_id;
    const mixed = comparison(p, [kent, good]).pairwise[0];
    expect(mixed.why_a_beats_b.winner).toBe(good); expect(mixed.why_a_beats_b.reason).toContain("eligibility");
    expect(comparison(p, [kent, ct]).pairwise[0].why_a_beats_b.winner).toBeNull();
    expect(() => comparison(project(), [kent, "county-99999"])).toThrow(/Unknown county/);
    expect(() => decisionTrace(project(), "county-99999")).toThrow(/Unknown county/);
    expect(() => rankingDiff(project(), project(), ["county-99999"])).toThrow(/Unknown county/);
  });
  it("validates API bodies, intake, all county IDs and ambiguous trace requests", async () => {
    const context = { params: Promise.resolve({ locationId: kent }) };
    const post = await tracePOST(request({ project: project() }), context);
    expect(post.status).toBe(200); expect((await post.json()).location_id).toBe(kent);
    const get = await traceGET(new Request("http://localhost/api?project=" + encodeURIComponent(JSON.stringify(project()))), context);
    expect(get.status).toBe(200);
    const ambiguous = await traceGET(new Request("http://localhost/api?project_id=x&project=%7B%7D"), context);
    expect(ambiguous.status).toBe(400);
    expect((await tracePOST(request({ project: {} }), context)).status).toBe(422);
    expect((await comparePOST(request({ project: project(), location_ids: [kent, kent] }))).status).toBe(400);
    expect((await comparePOST(request({ project: project(), location_ids: [kent, "county-99999"] }))).status).toBe(404);
    const diff = await diffPOST(request({ before_project: project(), after_project: project(), location_ids: [kent] }));
    expect(diff.status).toBe(200); expect((await diff.json()).scoring_version).toBe(versionsFor(snapshot).scoring_version);
  });
  it("rejects unsupported constraint claims and normalizes caller-supplied labels", () => {
    expect(() => projectSchema.parse(project({ weights: Object.fromEntries(categoryKeys.map((key) => [key, 0])) as ProjectState["weights"] }))).toThrow();
    expect(() => projectSchema.parse(project({ constraints: [{ ...fiber(90), metric: "utility_has_approved" }] }))).toThrow();
    const validated = projectSchema.parse(project({ constraints: [{ ...fiber(90), label: "Utility approved; fiber capacity guaranteed" }] }));
    expect(validated.constraints![0].label).not.toMatch(/approved|guaranteed/i);
    const text = JSON.stringify(decisionTrace(project(), kent));
    expect(text).not.toMatch(/500 MW is available|the utility has approved this|the community supports this|fiber capacity is guaranteed|this parcel is suitable/i);
    expect(text).toContain("not prediction accuracy"); expect(text).toContain("site_power_capacity");
  });
});
