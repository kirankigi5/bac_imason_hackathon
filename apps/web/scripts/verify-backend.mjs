import assert from "node:assert/strict";

const base = process.env.APP_URL ?? "http://localhost:3000";
async function api(path, body, method = body === undefined ? "GET" : "POST", expected = 200) {
  const response = await fetch(base + path, { method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(75000) });
  assert.equal(response.status, expected, `${method} ${path}: HTTP ${response.status}`);
  return response.json();
}
const intake = await api("/api/project/converse", { message: "I need a 500 MW AI training facility in the US by 2030 with low water risk." });
assert.equal(intake.readyToSearch, true);
assert.equal(intake.search.dataMode, "public_data");
const project = intake.project;
const saved = await api("/api/projects", { name: "Backend verification " + new Date().toISOString(), project }, "POST", 201);
const read = await api("/api/projects/" + saved.id);
assert.deepEqual(read.project, project);
assert.equal(read.ranking_snapshot_status, "CURRENT");
const id = "county-26081", alternate = intake.search.results[0].location_id;
const trace = await api(`/api/locations/${id}/decision-trace?project_id=${saved.id}`);
assert.equal(trace.location_id, id);
assert.equal(trace.feasibility.status, "CONDITIONALLY_FEASIBLE");
assert.equal(trace.available_ranking_metrics + trace.missing_ranking_metrics, 13);
assert.ok(trace.metrics.some((row) => row.metric === "fiber_coverage_pct" && row.source_as_of === "2025-12-31" && row.metric_type === "proxy"));
assert.ok(trace.major_missing_evidence.includes("community_acceptance"));
const comparison = await api("/api/compare", { project, location_ids: [id, alternate] });
const pair = comparison.pairwise[0];
assert.ok(Math.abs(pair.factor_deltas.reduce((sum, row) => sum + row.impact, 0) + pair.rounding_delta - pair.score_delta) < .00001);
const chat = await api("/api/project/converse", { projectId: saved.id, expectedRevision: 1, message: "Water matters even more" });
assert.equal(chat.project_record.revision, 2);
assert.ok(chat.project.weights.water > project.weights.water);
const changed = await api("/api/projects/" + saved.id);
assert.deepEqual(changed.last_ranking_snapshot.results, chat.search.results);
const diff = await api("/api/ranking/diff", { before_project: project, after_project: chat.project, location_ids: [id], top_n: 10 });
assert.ok(diff.changes.some((row) => row.field === "weights.water"));
const delta = diff.location_deltas.find((row) => row.location_id === id);
assert.equal(delta.old_score, trace.overall_score);
const nextTrace = await api(`/api/locations/${id}/decision-trace?project_id=${saved.id}`);
assert.equal(delta.new_score, nextTrace.overall_score);
const history = await api(`/api/projects/${saved.id}/history`);
assert.equal(history.integrity.valid, true);
assert.equal(history.events.length, 2);
assert.equal(history.events[1].source, "chat");
assert.equal(history.events[1].user_message, "Water matters even more");
for (const result of [trace, comparison, diff, intake.search, chat.search]) {
  for (const version of ["data_release_id", "scoring_version", "normalization_version"])
    assert.equal(result[version], changed.last_ranking_snapshot[version]);
}
await api(`/api/projects/${saved.id}`, { expected_revision: 1, name: "Stale update" }, "PATCH", 409);
await api("/api/compare", { project, location_ids: [id, "county-99999"] }, "POST", 404);
const strict = { ...project, constraints: [{ id: "fiber-min", label: "Fiber screening minimum", metric: "raw_metrics.fiber_coverage_pct", operator: ">=", value: 90, kind: "hard" }] };
const missing = await api("/api/locations/county-09110/decision-trace", { project: strict });
assert.equal(missing.feasibility.status, "INSUFFICIENT_DATA");
assert.equal(missing.rank, null);
console.log(JSON.stringify({ verification: "passed", endpoints: ["converse", "projects", "project-read", "project-history", "decision-trace", "compare", "ranking-diff", "revision-conflict"],
  ...Object.fromEntries(["data_release_id", "scoring_version", "normalization_version"].map((key) => [key, trace[key]])),
  audit_events: history.events.length, graph_sections: trace.explanation_graph.root.children.length,
  provider_mode: intake.provider.mode }, null, 2));
