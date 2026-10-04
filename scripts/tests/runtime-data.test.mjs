import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as tar from "tar";
import { buildRuntimeBundle, fileSha256, RELEASE_ID, restoreRuntimeData, validateArchive, validateRuntimeData } from "../lib/runtime-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let temporary, bundle, server, base, requests = 0;
before(async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-data-test-"));
  bundle = await buildRuntimeBundle(path.join(root, "data/feature_store"), path.join(temporary, "bundle"));
  server = http.createServer((request, response) => {
    requests++;
    if (request.url === "/truncated") {
      response.writeHead(200, { "Content-Length": 100000 });
      response.write("incomplete");
      response.destroy();
    } else if (request.url === "/missing") { response.writeHead(404); response.end(); }
    else { fs.createReadStream(path.join(temporary, request.url.slice(1))).pipe(response); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true });
});
const target = name => path.join(temporary, name, "feature_store");
const options = name => ({ dataDir: target(name), url: `${base}/bundle/${bundle.filename}`, checksum: bundle.sha256 });

test("packages the pinned real store deterministically with metadata and no excluded artifacts", async () => {
  const again = await buildRuntimeBundle(path.join(root, "data/feature_store"), path.join(temporary, "second"));
  assert.equal(again.sha256, bundle.sha256);
  assert.equal(again.file_count, 3112);
  assert.equal(again.county_count, 3109);
  assert.equal(again.data_mode, "public_data");
  assert.equal(again.release_id, RELEASE_ID);
  assert.equal(fs.readFileSync(again.archive_path + ".sha256", "utf8").split(" ")[0], bundle.sha256);
  assert.equal(JSON.parse(fs.readFileSync(again.archive_path + ".metadata.json")).sha256, bundle.sha256);
  const names = [];
  await tar.list({ file: again.archive_path, onReadEntry: entry => names.push(entry.path) });
  assert.equal(names.length, 3112);
  assert.ok(names.every(name => name.startsWith("feature_store/") && name.endsWith(".json")));
  assert.ok(!names.some(name => /evidence_store|parquet|duckdb|sqlite|seeds|raw\/|processed\//.test(name)));
  await validateArchive(again.archive_path);
});

test("restores atomically and validates existing data without another download", async () => {
  const first = await restoreRuntimeData(options("valid"));
  assert.equal(first.restored, true);
  assert.equal(validateRuntimeData(target("valid")).evidence_count, 71471);
  const count = requests;
  const second = await restoreRuntimeData({ dataDir: target("valid") });
  assert.equal(second.restored, false);
  assert.equal(requests, count);
  assert.ok(!fs.existsSync(path.join(target("valid"), "evidence_store.json")));
  assert.deepEqual(fs.readdirSync(path.dirname(target("valid"))), ["feature_store"]);
  const databasePath = path.join(temporary, "valid/projects/projects.sqlite");
  const cli = execFileSync(process.execPath, [path.join(root, "scripts/restore-runtime-data.mjs")], { encoding: "utf8",
    env: { ...process.env, DATA_DIR: target("valid"), PROJECT_DB_PATH: databasePath, RUNTIME_DATA_URL: "", RUNTIME_DATA_SHA256: "" } });
  assert.equal(JSON.parse(cli).runtime_data, "validated_existing");
  assert.ok(fs.statSync(path.dirname(databasePath)).isDirectory());
  assert.equal(requests, count);
});

test("a wrong checksum fails without exposing a partially restored store", async () => {
  await assert.rejects(restoreRuntimeData({ ...options("wrong-sha"), checksum: "0".repeat(64) }), /SHA-256 mismatch/);
  assert.equal(fs.existsSync(target("wrong-sha")), false);
  assert.deepEqual(fs.readdirSync(path.dirname(target("wrong-sha"))), []);
});

test("a failed download does not change an invalid existing store", async () => {
  fs.mkdirSync(target("previous"), { recursive: true });
  fs.writeFileSync(path.join(target("previous"), "manifest.json"), "old invalid manifest");
  await assert.rejects(restoreRuntimeData({ ...options("previous"), checksum: "0".repeat(64) }), /SHA-256 mismatch/);
  assert.equal(fs.readFileSync(path.join(target("previous"), "manifest.json"), "utf8"), "old invalid manifest");
  assert.deepEqual(fs.readdirSync(path.dirname(target("previous"))), ["feature_store"]);
});

test("a validated replacement preserves the invalid previous copy", async () => {
  fs.mkdirSync(target("replace"), { recursive: true });
  fs.writeFileSync(path.join(target("replace"), "manifest.json"), "old invalid manifest");
  const result = await restoreRuntimeData(options("replace"));
  assert.equal(result.restored, true);
  assert.equal(fs.readFileSync(path.join(result.preserved_invalid_store, "manifest.json"), "utf8"), "old invalid manifest");
  assert.equal(validateRuntimeData(target("replace")).release_id, RELEASE_ID);
});

test("missing URL or checksum fails closed instead of using seeds", async () => {
  await assert.rejects(restoreRuntimeData({ dataDir: target("absent") }), /No seeded fallback/);
  await assert.rejects(restoreRuntimeData({ dataDir: target("missing-sha"), url: options("missing-sha").url }), /SHA256 is required/);
  assert.equal(fs.existsSync(target("absent")), false);
});

test("missing and interrupted downloads leave no active data or partial files", async () => {
  for (const name of ["missing", "truncated"]) {
    await assert.rejects(restoreRuntimeData({ ...options(name), url: `${base}/${name}` }), /download failed/);
    assert.equal(fs.existsSync(target(name)), false);
    assert.deepEqual(fs.readdirSync(path.dirname(target(name))), []);
  }
});

test("unsafe remote URLs are rejected before download", async () => {
  for (const url of ["file:///etc/passwd", "http://example.com/bundle", "https://user:password@example.com/bundle"]) {
    await assert.rejects(restoreRuntimeData({ ...options("unsafe-url"), url }), /must be HTTPS/);
  }
});

test("seeded and mismatched manifests are never accepted as the active release", () => {
  const folder = target("bad-manifest");
  fs.mkdirSync(path.join(folder, "releases", RELEASE_ID), { recursive: true });
  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ data_mode: "seeded_demo" }));
  assert.throws(() => validateRuntimeData(folder), /seeded fallback/);
  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ data_mode: "public_data", store_path: "releases/other" }));
  assert.throws(() => validateRuntimeData(folder), /pinned partitioned release/);
});

test("symlink DATA_DIR is rejected without modifying its target", async () => {
  const original = path.join(temporary, "symlink-original");
  fs.mkdirSync(original);
  const linked = target("symlink");
  fs.mkdirSync(path.dirname(linked));
  fs.symlinkSync(original, linked);
  await assert.rejects(restoreRuntimeData({ ...options("symlink"), dataDir: linked }), /must not be a symlink/);
  assert.deepEqual(fs.readdirSync(original), []);
});

async function unsafeArchive(name, kind) {
  const directory = path.join(temporary, name);
  fs.mkdirSync(directory);
  if (kind === "link") fs.symlinkSync("/tmp/not-a-runtime-file", path.join(directory, "manifest.json"));
  else if (kind === "oversized") { fs.writeFileSync(path.join(directory, "location_features.json"), ""); fs.truncateSync(path.join(directory, "location_features.json"), 32 * 1024 * 1024 + 1); }
  else fs.writeFileSync(path.join(directory, "raw.csv"), "not runtime data");
  const archive = path.join(temporary, name + ".tar.gz");
  const prefix = kind === "oversized" ? `feature_store/releases/${RELEASE_ID}` : "feature_store";
  await tar.create({ cwd: directory, prefix, file: archive, gzip: true, portable: true }, fs.readdirSync(directory));
  return archive;
}
for (const kind of ["link", "oversized", "extra-file"]) {
  test(`rejects ${kind} archive entries before extraction`, async () => {
    const archive = await unsafeArchive("bad-" + kind, kind);
    await assert.rejects(validateArchive(archive), /Unsafe/);
    await assert.rejects(restoreRuntimeData({ ...options("archive-" + kind),
      url: `${base}/${path.basename(archive)}`, checksum: await fileSha256(archive) }), /Unsafe/);
    assert.equal(fs.existsSync(target("archive-" + kind)), false);
  });
}
