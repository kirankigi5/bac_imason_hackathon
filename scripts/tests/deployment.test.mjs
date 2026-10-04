import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { prepareDirectories, validateDeploymentConfig, verifyClientSecrets, verifySqlite } from "../lib/deployment.mjs";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deployment-test-"));
after(() => fs.rmSync(temporary, { recursive: true, force: true }));
const local = { RUNTIME_ROOT: temporary, DATA_DIR: path.join(temporary, "feature_store"),
  PROJECT_DB_PATH: path.join(temporary, "projects/projects.sqlite"), PORT: "3027", LLM_PROVIDER: "local" };

test("validates deployment paths, server-only Gemini aliases and explicit local tests", () => {
  assert.equal(validateDeploymentConfig(local).port, 3027);
  const gemini = validateDeploymentConfig({ ...local, LLM_PROVIDER: "gemini", LLM_MODEL: "fixture-model", GOOGLE_API_KEY: "fixture-server-key" });
  assert.equal(gemini.provider, "gemini");
  assert.equal(gemini.remoteProviderConfigured, true);
  prepareDirectories(gemini);
  assert.ok(fs.statSync(path.dirname(gemini.databasePath)).isDirectory());
});

test("rejects missing provider credentials, public credentials and ephemeral Railway state", () => {
  assert.throws(() => validateDeploymentConfig({ ...local, LLM_PROVIDER: "gemini" }), /credential and LLM_MODEL/);
  assert.throws(() => validateDeploymentConfig({ ...local, NEXT_PUBLIC_GEMINI_API_KEY: "fixture-server-key" }), /server-side/);
  assert.throws(() => validateDeploymentConfig({ ...local, RAILWAY_SERVICE_ID: "fixture-service" }), /persistent volume/);
  assert.throws(() => validateDeploymentConfig({ ...local, PROJECT_DB_PATH: path.join(local.DATA_DIR, "projects.sqlite") }), /separate locations/);
  assert.throws(() => validateDeploymentConfig({ ...local, DATA_DIR: "/tmp/outside" }), /inside the persistent/);
  assert.throws(() => validateDeploymentConfig({ ...local, PORT: "invalid" }), /PORT/);
});

test("SQLite write probe rolls back and retained state survives another process", () => {
  prepareDirectories(validateDeploymentConfig(local));
  const database = new DatabaseSync(local.PROJECT_DB_PATH);
  database.exec("CREATE TABLE saved_fixture (name TEXT); INSERT INTO saved_fixture VALUES ('retained')");
  database.close();
  assert.equal(verifySqlite(local.PROJECT_DB_PATH), true);
  const result = execFileSync(process.execPath, ["--input-type=module", "-e",
    "import { DatabaseSync } from 'node:sqlite'; const db=new DatabaseSync(process.argv[1]); console.log(JSON.stringify({row:db.prepare('SELECT name FROM saved_fixture').get(),tables:db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all()})); db.close();",
    local.PROJECT_DB_PATH], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(result), { row: { name: "retained" }, tables: [{ name: "saved_fixture" }] });
});

test("client assets must not contain a configured server credential", () => {
  const staticDir = path.join(temporary, "static");
  fs.mkdirSync(staticDir);
  fs.writeFileSync(path.join(staticDir, "safe.js"), "console.log('safe')");
  assert.equal(verifyClientSecrets(staticDir, { GEMINI_API_KEY: "fixture-server-key" }), true);
  fs.writeFileSync(path.join(staticDir, "unsafe.js"), "fixture-server-key");
  assert.throws(() => verifyClientSecrets(staticDir, { GEMINI_API_KEY: "fixture-server-key" }), /Server credential/);
});
