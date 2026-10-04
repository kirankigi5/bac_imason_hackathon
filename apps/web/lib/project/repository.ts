import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { ProjectState, RankedLocation, RankingVersions } from "@/lib/types/domain";
import { canonicalJSON, stableHash } from "@/lib/backend/cache";
import { DecisionError } from "@/lib/backend/decisions";

export type SavedRanking = RankingVersions & { project_hash: string; ranking_hash: string; generated_at: string;
  feasible_count: number; excluded_count: number; results: RankedLocation[] };
export type SavedProject = { id: string; name: string; project: ProjectState; revision: number;
  last_ranking_snapshot: SavedRanking | null; created_at: string; updated_at: string };
export type AuditContext = { source: "api" | "chat" | "filters"; user_message?: string };
export type AuditChange = { field: string; old_value: unknown; new_value: unknown };
type AuditData = AuditContext & { interpreted_change: AuditChange[]; ranking_effect_summary: unknown; versions: RankingVersions };
export type ProjectEvent = AuditData & { id: string; project_id: string; revision: number; timestamp: string;
  old_value: { name: string; project: ProjectState } | null; new_value: { name: string; project: ProjectState };
  previous_hash: string | null; event_hash: string };

export class ProjectRepository {
  private database: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(filename);
    if (filename !== ":memory:") fs.chmodSync(filename, 0o600);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, state_json TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision > 0), snapshot_json TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS project_events (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        revision INTEGER NOT NULL, payload_json TEXT NOT NULL,
        previous_hash TEXT, event_hash TEXT NOT NULL, UNIQUE(project_id, revision)
      ) STRICT;
      CREATE TRIGGER IF NOT EXISTS events_immutable_update BEFORE UPDATE ON project_events
      BEGIN SELECT RAISE(ABORT, 'Audit events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS events_immutable_delete BEFORE DELETE ON project_events
      BEGIN SELECT RAISE(ABORT, 'Audit events are append-only'); END;
    `);
  }
  close() { this.database.close(); }
  get(id: string): SavedProject {
    const row = this.database.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    if (!row) throw new DecisionError(404, "Project not found");
    return { id: String(row.id), name: String(row.name), project: JSON.parse(String(row.state_json)), revision: Number(row.revision),
      last_ranking_snapshot: row.snapshot_json === null ? null : JSON.parse(String(row.snapshot_json)),
      created_at: String(row.created_at), updated_at: String(row.updated_at) };
  }
  list(): SavedProject[] {
    return this.database.prepare("SELECT id FROM projects ORDER BY updated_at DESC, id LIMIT 50").all().map((row) => this.get(String(row.id)));
  }
  create(name: string, project: ProjectState, snapshot: SavedRanking | null, audit: AuditData): SavedProject {
    const timestamp = new Date().toISOString(), id = randomUUID();
    return this.transaction(() => {
      this.database.prepare("INSERT INTO projects VALUES (?, ?, ?, 1, ?, ?, ?)")
        .run(id, name, canonicalJSON(project), snapshot ? canonicalJSON(snapshot) : null, timestamp, timestamp);
      this.appendEvent(id, 1, timestamp, null, { name, project }, audit);
      return this.get(id);
    });
  }
  update(id: string, expectedRevision: number, name: string, project: ProjectState, snapshot: SavedRanking | null, audit: AuditData): SavedProject {
    return this.transaction(() => {
      const old = this.get(id);
      if (old.revision !== expectedRevision) throw new DecisionError(409, "Project revision changed; reload before updating");
      if (!this.history(id).integrity.valid) throw new DecisionError(503, "Project audit integrity failed; no update committed");
      const timestamp = new Date().toISOString();
      this.database.prepare("UPDATE projects SET name = ?, state_json = ?, revision = ?, snapshot_json = ?, updated_at = ? WHERE id = ?")
        .run(name, canonicalJSON(project), old.revision + 1, snapshot ? canonicalJSON(snapshot) : null, timestamp, id);
      this.appendEvent(id, old.revision + 1, timestamp, { name: old.name, project: old.project }, { name, project }, audit);
      return this.get(id);
    });
  }
  history(id: string) {
    const project = this.get(id);
    const rows = this.database.prepare("SELECT * FROM project_events WHERE project_id = ? ORDER BY revision").all(id);
    let previous: string | null = null, valid = true;
    const events = rows.map((row, index): ProjectEvent => {
      const payload = JSON.parse(String(row.payload_json)) as Omit<ProjectEvent, "previous_hash" | "event_hash">;
      const prior = row.previous_hash === null ? null : String(row.previous_hash), digest = String(row.event_hash);
      if (prior !== previous || Number(row.revision) !== index + 1 || payload.revision !== index + 1 || payload.project_id !== id
        || payload.id !== row.id || stableHash({ ...payload, previous_hash: prior }) !== digest) valid = false;
      previous = digest;
      return { ...payload, previous_hash: prior, event_hash: digest };
    });
    const head = events.at(-1);
    if (events.length !== project.revision || !head || canonicalJSON(head.new_value) !== canonicalJSON({ name: project.name, project: project.project })) valid = false;
    return { project_id: id, events, integrity: { valid, event_count: events.length, head_hash: previous,
      scope: "Local append-only hash chain and current-state consistency; not externally signed or tamper-proof against DB administrators" } };
  }
  private appendEvent(id: string, revision: number, timestamp: string, oldValue: ProjectEvent["old_value"], newValue: ProjectEvent["new_value"], audit: AuditData) {
    const previous = this.database.prepare("SELECT event_hash FROM project_events WHERE project_id = ? ORDER BY revision DESC LIMIT 1").get(id);
    const previous_hash = previous ? String(previous.event_hash) : null;
    const payload = { ...audit, id: randomUUID(), project_id: id, revision, timestamp, old_value: oldValue, new_value: newValue };
    const event_hash = stableHash({ ...payload, previous_hash });
    this.database.prepare("INSERT INTO project_events VALUES (?, ?, ?, ?, ?, ?)")
      .run(payload.id, id, revision, canonicalJSON(payload), previous_hash, event_hash);
  }
  private transaction<T>(work: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.database.exec("COMMIT"); return result; }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
}

let current: { filename: string; repository: ProjectRepository } | undefined;
export function getProjectRepository() {
  const filename = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.PROJECT_DB_PATH ?? "../../data/projects/projects.sqlite");
  if (current?.filename !== filename) {
    current?.repository.close(); current = { filename, repository: new ProjectRepository(filename) };
  }
  return current.repository;
}
export function closeProjectRepository() { current?.repository.close(); current = undefined; }
