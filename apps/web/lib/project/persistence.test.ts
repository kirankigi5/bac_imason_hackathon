// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloneProject } from "./defaults";
import { closeProjectRepository, getProjectRepository } from "./repository";
import { createProject, projectWithFreshness, updateProject } from "./persistence";
import { converse } from "./conversation";
import { LocalDeterministicProvider } from "@/lib/llm/provider";
import { getStoreSnapshot } from "@/lib/data/store";
import { GET as listGET, POST as createPOST } from "@/app/api/projects/route";
import { GET as projectGET, PATCH } from "@/app/api/projects/[id]/route";
import { GET as historyGET } from "@/app/api/projects/[id]/history/route";
import { GET as traceGET } from "@/app/api/locations/[locationId]/decision-trace/route";

let directory: string, filename: string;
const complete = () => cloneProject({ capacityMw: 500, workloadType: "AI_TRAINING", geography: { country: "US" },
  targetGoLiveYear: 2030, planningHorizonYear: 2040, activePrioritySignals: ["water"],
  selectedLocationId: "county-26081", compareLocationIds: ["county-26081", "county-04013"] });
const request = (body: unknown, method = "POST") => new Request("http://localhost/api/projects", { method, body: JSON.stringify(body) });
const context = (id: string) => ({ params: Promise.resolve({ id }) });
beforeEach(() => {
  closeProjectRepository(); directory = fs.mkdtempSync(path.join(os.tmpdir(), "county-project-test-"));
  filename = path.join(directory, "projects.sqlite"); vi.stubEnv("PROJECT_DB_PATH", filename);
});
afterEach(() => { closeProjectRepository(); vi.unstubAllEnvs(); fs.rmSync(directory, { recursive: true, force: true }); });

describe("local SQLite project persistence and audit", () => {
  it("creates, reads, updates and reopens canonical state plus its last ranking", () => {
    const p = complete(), saved = createProject("Real county study", p);
    expect(saved.project).toEqual(p); expect(saved.revision).toBe(1); expect(saved.ranking_snapshot_status).toBe("CURRENT");
    expect(saved.last_ranking_snapshot!.results).toHaveLength(20);
    expect(saved.last_ranking_snapshot!.data_release_id).toBe(getStoreSnapshot().manifest.store_path!.split("/").at(-1));
    const changed = updateProject(saved.id, 1, { capacityMw: 700 }, "Revised study", { source: "filters", user_message: "700 MW instead" });
    expect(changed.revision).toBe(2); expect(changed.project.capacityMw).toBe(700);
    expect(changed.project.compareLocationIds).toEqual(p.compareLocationIds); expect(changed.project.planningHorizonYear).toBe(2040);
    expect(Date.parse(changed.updated_at)).toBeGreaterThanOrEqual(Date.parse(saved.updated_at));
    closeProjectRepository(); expect(getProjectRepository().get(saved.id)).toEqual(expect.objectContaining({ name: "Revised study", revision: 2, project: changed.project }));
    expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
  });
  it("stores exact old/new values, source, message, versions and a verified hash chain", () => {
    const saved = createProject("Study", complete());
    const changed = updateProject(saved.id, 1, { capacityMw: 700 }, undefined, { source: "chat", user_message: "I need 700 MW" });
    const history = getProjectRepository().history(saved.id), event = history.events[1];
    expect(history.integrity.valid).toBe(true); expect(history.events).toHaveLength(2);
    expect(event.source).toBe("chat"); expect(event.user_message).toBe("I need 700 MW");
    expect(event.old_value!.project.capacityMw).toBe(500); expect(event.new_value.project).toEqual(changed.project);
    expect(event.interpreted_change).toContainEqual({ field: "capacityMw", old_value: 500, new_value: 700 });
    expect(event.ranking_effect_summary).toHaveProperty("top_1_before");
    expect(event.ranking_effect_summary).toHaveProperty("top_1_after");
    expect(event.versions.data_release_id).toBe(changed.last_ranking_snapshot!.data_release_id);
    expect(event.previous_hash).toBe(history.events[0].event_hash); expect(Date.parse(event.timestamp)).not.toBeNaN();
  });
  it("rejects stale revisions without adding an audit event", () => {
    const saved = createProject("Study", complete()); updateProject(saved.id, 1, { capacityMw: 600 });
    expect(() => updateProject(saved.id, 1, { capacityMw: 700 })).toThrow(/revision changed/);
    expect(getProjectRepository().get(saved.id).project.capacityMw).toBe(600);
    expect(getProjectRepository().history(saved.id).events).toHaveLength(2);
  });
  it("rolls back the project row when inserting its audit event fails", () => {
    const saved = createProject("Study", complete()), db = new DatabaseSync(filename);
    db.exec("CREATE TRIGGER reject_test_event BEFORE INSERT ON project_events BEGIN SELECT RAISE(ABORT, 'Injected test failure'); END;");
    expect(() => updateProject(saved.id, 1, { capacityMw: 700 })).toThrow(/Injected test failure/);
    expect(getProjectRepository().get(saved.id).revision).toBe(1);
    expect(getProjectRepository().get(saved.id).project.capacityMw).toBe(500);
    expect(getProjectRepository().history(saved.id).events).toHaveLength(1); db.close();
  });
  it("prevents audit update/deletion and detects out-of-band project changes", () => {
    const saved = createProject("Study", complete()), db = new DatabaseSync(filename);
    expect(() => db.prepare("DELETE FROM project_events WHERE project_id = ?").run(saved.id)).toThrow(/append-only/);
    expect(() => db.prepare("UPDATE project_events SET event_hash = 'fake' WHERE project_id = ?").run(saved.id)).toThrow(/append-only/);
    db.prepare("UPDATE projects SET name = 'Tampered' WHERE id = ?").run(saved.id); db.close();
    expect(getProjectRepository().history(saved.id).integrity.valid).toBe(false);
    expect(() => updateProject(saved.id, 1, { capacityMw: 700 })).toThrow(/audit integrity failed/);
    expect(getProjectRepository().get(saved.id).revision).toBe(1);
  });
  it("allows intake drafts but never generates rankings before profile completion", () => {
    const draft = createProject("Intake draft"); expect(draft.last_ranking_snapshot).toBeNull();
    expect(draft.ranking_snapshot_status).toBe("NOT_EVALUATED"); expect(draft.missing_required_fields).toContain("capacity");
    const updated = updateProject(draft.id, 1, { capacityMw: 500 }); expect(updated.last_ranking_snapshot).toBeNull();
    expect(getProjectRepository().history(draft.id).integrity.valid).toBe(true);
  });
  it("marks historic snapshots stale without silently replacing them", () => {
    const saved = createProject("Study", complete()), snapshot = getStoreSnapshot();
    const newer = { ...snapshot, manifest: { ...snapshot.manifest, store_path: "releases/22222222222222222222" } };
    const stale = projectWithFreshness(getProjectRepository().get(saved.id), newer);
    expect(stale.ranking_snapshot_status).toBe("STALE");
    expect(stale.last_ranking_snapshot).toEqual(saved.last_ranking_snapshot);
    expect(stale.current_versions.data_release_id).not.toBe(saved.last_ranking_snapshot!.data_release_id);
  });
  it("rejects unknown selected counties without any committed project", () => {
    expect(() => createProject("Bad selection", { ...complete(), selectedLocationId: "county-99999" })).toThrow(/Unknown selected county/);
    expect(getProjectRepository().list()).toHaveLength(0);
  });
  it("persists chat and authoritative filter updates with correct audit sources", async () => {
    const saved = createProject("Study", complete()), provider = new LocalDeterministicProvider();
    const chat = await converse({ projectId: saved.id, expectedRevision: 1, message: "Water matters even more" }, provider);
    expect(chat.project_record!.revision).toBe(2);
    expect(getProjectRepository().get(saved.id).project).toEqual(chat.project);
    expect(getProjectRepository().get(saved.id).last_ranking_snapshot!.results).toEqual(chat.search!.results);
    const next = cloneProject(chat.project); next.capacityMw = 700;
    const filtered = await converse({ source: "filters", projectId: saved.id, expectedRevision: 2,
      message: "Use these filters", currentProject: next }, provider);
    expect(filtered.project_record!.revision).toBe(3);
    expect(getProjectRepository().history(saved.id).events.map((row) => row.source)).toEqual(["api", "chat", "filters"]);
    const explained = await converse({ projectId: saved.id, expectedRevision: 3, message: "Why here?" }, provider);
    expect(explained.project_record!.revision).toBe(3); expect(getProjectRepository().history(saved.id).events).toHaveLength(3);
  });
  it("exposes validated CRUD, saved-project traces, history and conflicts via API", async () => {
    expect((await createPOST(request({ name: "Study", ranking_snapshot: {} }))).status).toBe(400);
    const response = await createPOST(request({ name: "Study", project: complete() }));
    expect(response.status).toBe(201); const saved = await response.json();
    expect((await projectGET(new Request("http://localhost/api"), context(saved.id))).status).toBe(200);
    const patch = await PATCH(request({ expected_revision: 1, project: { capacityMw: 700 }, source: "filters" }, "PATCH"), context(saved.id));
    expect(patch.status).toBe(200);
    expect((await PATCH(request({ expected_revision: 1, name: "Stale edit" }, "PATCH"), context(saved.id))).status).toBe(409);
    expect((await PATCH(request({ name: "Missing revision" }, "PATCH"), context(saved.id))).status).toBe(400);
    const history = await historyGET(new Request("http://localhost/api"), context(saved.id));
    expect((await history.json()).integrity.valid).toBe(true);
    expect((await (await listGET()).json()).projects).toHaveLength(1);
    const trace = await traceGET(new Request("http://localhost/api?project_id=" + saved.id), { params: Promise.resolve({ locationId: "county-26081" }) });
    expect(trace.status).toBe(200); expect((await trace.json()).feasibility.status).toBe("CONDITIONALLY_FEASIBLE");
  });
});
