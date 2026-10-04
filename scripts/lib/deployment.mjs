import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { assert, COUNTY_COUNT, RELEASE_ID } from "./runtime-data.mjs";

function within(root, filename) {
  const relative = path.relative(root, filename);
  return relative && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}
export function validateDeploymentConfig(env = process.env) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  assert(major > 22 || major === 22 && minor >= 13, "Node.js 22.13 or newer is required.");
  const runtimeRoot = env.RUNTIME_ROOT || "/app/runtime";
  assert(path.isAbsolute(runtimeRoot) && runtimeRoot !== path.parse(runtimeRoot).root, "RUNTIME_ROOT must be a dedicated absolute directory.");
  assert(env.DATA_DIR && path.isAbsolute(env.DATA_DIR) && env.PROJECT_DB_PATH && path.isAbsolute(env.PROJECT_DB_PATH),
    "Absolute DATA_DIR and PROJECT_DB_PATH are required.");
  assert(within(runtimeRoot, env.DATA_DIR) && within(runtimeRoot, env.PROJECT_DB_PATH)
    && env.DATA_DIR !== env.PROJECT_DB_PATH && !within(env.DATA_DIR, env.PROJECT_DB_PATH),
  "Data and SQLite must use separate locations inside the persistent runtime directory.");
  assert(!env.RAILWAY_SERVICE_ID || env.RAILWAY_VOLUME_MOUNT_PATH === runtimeRoot,
    "Railway requires a persistent volume mounted at RUNTIME_ROOT before startup.");
  const port = env.PORT || "3000";
  assert(/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535, "PORT must be between 1 and 65535.");
  assert(!Object.entries(env).some(([key, value]) => value && /^NEXT_PUBLIC_/.test(key)
    && /LLM|GEMINI|GOOGLE_API|OPENAI|OPENROUTER|SECRET|PASSWORD|API_KEY/.test(key)), "LLM settings and credentials must remain server-side.");
  const provider = env.LLM_PROVIDER;
  assert(["local", "gemini", "openai", "openrouter"].includes(provider), "An explicit supported LLM_PROVIDER is required.");
  const key = provider === "gemini" ? env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.LLM_API_KEY
    : env.LLM_API_KEY || (provider === "openrouter" ? env.OPENROUTER_API_KEY : env.OPENAI_API_KEY);
  assert(provider === "local" || key && env.LLM_MODEL, "Configured remote provider requires a server-side credential and LLM_MODEL.");
  return { runtimeRoot, dataDir: env.DATA_DIR, databasePath: env.PROJECT_DB_PATH, port: Number(port),
    provider, remoteProviderConfigured: provider !== "local" };
}

export function prepareDirectories(config) {
  for (const filename of [config.runtimeRoot, path.dirname(config.dataDir), path.dirname(config.databasePath)]) {
    fs.mkdirSync(filename, { recursive: true, mode: 0o700 });
    assert(fs.lstatSync(filename).isDirectory(), "Runtime paths must not be symlinks.");
  }
}
export function verifySqlite(databasePath) {
  const database = new DatabaseSync(databasePath);
  try {
    fs.chmodSync(databasePath, 0o600);
    fs.accessSync(databasePath, fs.constants.R_OK | fs.constants.W_OK);
    database.exec("PRAGMA busy_timeout = 5000");
    assert(Object.values(database.prepare("PRAGMA quick_check").get())[0] === "ok", "SQLite integrity check failed.");
    // A rolled-back transaction checks real write access without changing saved projects.
    database.exec("BEGIN IMMEDIATE");
    try { database.exec(`CREATE TABLE "deployment_probe_${randomUUID().replaceAll("-", "")}" (value INTEGER)`); }
    finally { database.exec("ROLLBACK"); }
  } finally { database.close(); }
  return true;
}
export function verifyClientSecrets(staticDir, env = process.env) {
  const credentials = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "LLM_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"]
    .map(name => env[name]).filter(value => value && value.length >= 10);
  assert(fs.existsSync(staticDir), "Production client assets are missing; run the production build.");
  function visit(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, item.name);
      if (item.isDirectory()) visit(filename);
      else if (/\.(?:js|map)$/.test(item.name)) {
        const text = fs.readFileSync(filename, "utf8");
        assert(!credentials.some(value => text.includes(value)), "Server credential detected in client assets.");
      }
    }
  }
  visit(staticDir);
  return true;
}

export async function verifyLiveApp(base, expectedProvider) {
  const project = { capacityMw: 500, workloadType: "AI_TRAINING", targetGoLiveYear: 2030,
    geography: { country: "US", states: [] }, activePrioritySignals: ["water"], constraints: [] };
  async function api(route, body) {
    const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(30000),
      ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    assert(response.ok, `Deployment probe failed: ${route}, HTTP ${response.status}.`);
    return response.json();
  }
  const search = await api("/api/locations/search", { project });
  assert(search.dataMode === "public_data" && search.data_release_id === RELEASE_ID, "Live app is not using the pinned real release.");
  assert(search.results?.length > 0 && search.feasibleCount + search.excluded.length === COUNTY_COUNT,
    "Live ranking does not cover the expected 3,109 counties.");
  assert(search.results.every((row, index) => row.rank === index + 1 && Number.isFinite(row.overall_score)), "Live ranking is invalid.");
  const trace = await api(`/api/locations/${search.results[0].location_id}/decision-trace`, { project: search.project });
  assert(trace.data_release_id === RELEASE_ID && trace.overall_score === search.results[0].overall_score
    && trace.metrics?.length > 0, "Selected county evidence/trace does not match the live ranking.");
  const status = await api("/api/project/status");
  assert(!expectedProvider || status.provider === expectedProvider, "Live provider configuration does not match the server environment.");
  return { ranking: "passed", release_id: search.data_release_id, county_count: COUNTY_COUNT,
    scoring_version: search.scoring_version, provider: status.provider, provider_health: status.health?.status,
    paid_llm_call_performed: false };
}
