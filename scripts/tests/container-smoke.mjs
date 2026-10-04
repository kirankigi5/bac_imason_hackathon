import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fileSha256, RELEASE_ID } from "../lib/runtime-data.mjs";
import { verifyLiveApp } from "../lib/deployment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const image = process.env.TEST_DOCKER_IMAGE || "bac-imason:railway";
const filename = `runtime-data-${RELEASE_ID}.tar.gz`;
const archive = path.join(root, "artifacts/runtime", filename);
const checksum = await fileSha256(archive);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "railway-container-test-"));
const prefix = `bac-railway-test-${process.pid}`;
const containers = [];
function docker(...args) {
  const result = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || "Docker command failed.");
  return (result.stdout + (args[0] === "logs" ? result.stderr : "")).trim();
}
function launch(name, args) {
  containers.push(name);
  return docker("run", "--detach", "--name", name, ...args);
}
async function api(base, route, body) {
  const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(5000),
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `${route}: HTTP ${response.status}`);
  return response.json();
}
async function healthy(base, name) {
  for (let i = 0; i < 90; i++) {
    try { await api(base, "/api/project/status"); return; } catch { /* Wait for startup, not a provider call. */ }
    assert.equal(docker("inspect", "--format", "{{.State.Running}}", name), "true", "Container exited before readiness.");
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("Container readiness timed out.");
}
try {
  // Sharing this fixture's network makes its HTTP URL strictly loopback-only.
  const asset = prefix + "-asset";
  const fixture = `const fs=require('node:fs');require('node:http').createServer((req,res)=>{
    console.log('bundle-request'); if(req.url!=='/${filename}'){res.writeHead(404);return res.end();}
    fs.createReadStream('/bundles/${filename}').pipe(res);
  }).listen(8081,'0.0.0.0');`;
  launch(asset, ["--publish", "127.0.0.1::3027", "--mount", `type=bind,source=${path.dirname(archive)},target=/bundles,readonly`, image, "node", "-e", fixture]);
  const port = docker("port", asset, "3027/tcp").split(":").at(-1);
  const base = `http://127.0.0.1:${port}`;
  const volume = path.join(temporary, "runtime");
  fs.mkdirSync(volume);
  const common = ["--network", `container:${asset}`, "--mount", `type=bind,source=${volume},target=/app/runtime`,
    "--env", "PORT=3027", "--env", "LLM_PROVIDER=gemini", "--env", "LLM_MODEL=fixture-model",
    "--env", "GEMINI_API_KEY=fixture-server-key", "--env", `RUNTIME_DATA_URL=http://127.0.0.1:8081/${filename}`,
    "--env", `RUNTIME_DATA_SHA256=${checksum}`];
  const app = prefix + "-app";
  launch(app, [...common, image]);
  await healthy(base, app);
  for (const route of ["/", "/maplibre/maplibre-gl-worker.mjs", "/maplibre/maplibre-gl-shared.mjs"]) {
    const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, `Production asset missing: ${route}`);
    assert.ok((await response.text()).length > 100);
  }
  const live = await verifyLiveApp(base, "gemini");
  const startup = JSON.parse(docker("exec", "--user", "node", app, "node", "/app/scripts/verify-deployment.mjs"));
  assert.equal(startup.sqlite_writable, true);
  assert.equal(startup.client_credentials_absent, true);
  assert.match(docker("exec", app, "node", "-e", "console.log(require('node:fs').readFileSync('/proc/1/status','utf8'))"), /^Uid:\s+1000\s+1000\s+1000\s+1000$/m);
  const search = await api(base, "/api/locations/search", { project: { capacityMw: 500, workloadType: "AI_TRAINING",
    targetGoLiveYear: 2030, geography: { country: "US", states: [] }, activePrioritySignals: ["water"], constraints: [] } });
  const saved = await api(base, "/api/projects", { name: "Container persistence smoke test", project: search.project });
  const history = await api(base, `/api/projects/${saved.id}/history`);
  assert.equal(saved.last_ranking_snapshot.data_release_id, RELEASE_ID);
  assert.ok(fs.existsSync(path.join(volume, "projects/projects.sqlite")));
  docker("restart", app);
  await healthy(base, app);
  const recovered = await api(base, `/api/projects/${saved.id}`);
  assert.equal(recovered.id, saved.id);
  assert.equal(recovered.revision, saved.revision);
  assert.deepEqual(recovered.project, saved.project);
  assert.deepEqual(await api(base, `/api/projects/${saved.id}/history`), history);
  const logs = docker("logs", app);
  assert.match(logs, /restored/);
  assert.match(logs, /validated_existing/);
  assert.equal(docker("logs", asset).split("bundle-request").length - 1, 1);
  assert.ok(!logs.includes("fixture-server-key"));
  docker("stop", app);
  for (const failure of ["bad-checksum", "missing-bundle"]) {
    const target = path.join(temporary, failure);
    fs.mkdirSync(target);
    const name = prefix + "-" + failure;
    const args = ["--network", `container:${asset}`, "--mount", `type=bind,source=${target},target=/app/runtime`, "--env", "LLM_PROVIDER=local"];
    if (failure === "bad-checksum") args.push("--env", `RUNTIME_DATA_URL=http://127.0.0.1:8081/${filename}`, "--env", `RUNTIME_DATA_SHA256=${"0".repeat(64)}`);
    launch(name, [...args, image]);
    const exitCode = Number(docker("wait", name));
    assert.notEqual(exitCode, 0);
    assert.equal(fs.existsSync(path.join(target, "feature_store")), false);
    assert.ok(!fs.readdirSync(target).some(file => file.startsWith(".runtime-restore-")));
    assert.match(docker("logs", name), failure === "bad-checksum" ? /SHA-256 mismatch/ : /No seeded fallback/);
  }
  const imageAudit = docker("run", "--rm", image, "node", "-e", `const fs=require('node:fs');
    for(const name of ['/app/runtime','/app/data','/app/.env.local','/app/apps/web/.env.local','/app/apps/web/.next/cache']){
      if(fs.existsSync(name))throw new Error('Unexpected packaged file: '+name);
    } console.log(JSON.stringify({node:process.version,host_runtime_and_credentials_absent:true}));`);
  console.log(JSON.stringify({ verification: "passed", ...live, sqlite_persisted_across_restart: true,
    second_startup_reused_bundle: true, bad_checksum_failed_closed: true, missing_bundle_failed_closed: true,
    nonroot_app: true, image_audit: JSON.parse(imageAudit) }, null, 2));
} finally {
  for (const name of containers.reverse()) {
    try { docker("rm", "--force", name); } catch { /* Only remove this test's containers. */ }
  }
  fs.rmSync(temporary, { recursive: true, force: true });
}
