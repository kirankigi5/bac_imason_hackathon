import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import * as tar from "tar";

export const RELEASE_ID = "ec0ed269269ed0f45e5b";
export const COUNTY_COUNT = 3109;
export const EVIDENCE_COUNT = 71471;
const releasePath = `releases/${RELEASE_ID}`;
const manifestSha = "4e9f422e551ab348547a7df48e4a610c582343643966b7d1d5f01a8ea218508e";
const featuresSha = "b49daf3a5a597865c8784d637995310223540810108d9b180f98a737f9b9b836";
const evidenceTreeSha = "cd7e9fedefdf122c9d5d80912cab47cc12ac4003c1ff80dfc392de5b8add4f4e";
const maxDownloadBytes = 64 * 1024 * 1024;
const maxExpandedBytes = 160 * 1024 * 1024;

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
export function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
export async function fileSha256(filename) {
  const digest = createHash("sha256");
  for await (const chunk of fs.createReadStream(filename)) digest.update(chunk);
  return digest.digest("hex");
}
function directory(filename) {
  assert(fs.lstatSync(filename).isDirectory(), "Runtime directories must be real directories, not symlinks.");
}
function readFile(filename, limit) {
  const stat = fs.lstatSync(filename);
  assert(stat.isFile() && stat.size <= limit, "Required runtime file is missing, unsafe or oversized.");
  return fs.readFileSync(filename);
}

export function validateRuntimeData(root) {
  directory(root);
  directory(path.join(root, "releases"));
  directory(path.join(root, releasePath));
  const rawManifest = readFile(path.join(root, "manifest.json"), 64 * 1024);
  const manifest = JSON.parse(rawManifest);
  assert(manifest.data_mode === "public_data", "Production requires public_data; seeded fallback is forbidden.");
  assert(manifest.store_path === releasePath && manifest.partitioned_evidence === true,
    "Runtime manifest does not select the pinned partitioned release.");
  assert(manifest.location_count === COUNTY_COUNT && manifest.evidence_count === EVIDENCE_COUNT,
    "Runtime manifest has unexpected county/evidence counts.");
  assert(sha256(rawManifest) === manifestSha, "Pinned runtime manifest checksum does not match.");
  assert(sha256(readFile(path.join(root, releasePath, "manifest.json"), 64 * 1024)) === manifestSha,
    "Root and selected-release manifests do not match.");
  const rawFeatures = readFile(path.join(root, releasePath, "location_features.json"), 32 * 1024 * 1024);
  assert(sha256(rawFeatures) === featuresSha && manifest.artifact_checksums?.["location_features.json"] === featuresSha,
    "Pinned location features checksum does not match.");
  const features = JSON.parse(rawFeatures);
  assert(Array.isArray(features) && features.length === COUNTY_COUNT, "Runtime requires exactly 3,109 counties.");
  const ids = new Set();
  for (const row of features) {
    assert(/^\d{5}$/.test(row.county_fips) && row.location_id === `county-${row.county_fips}` && !ids.has(row.location_id),
      "Invalid or duplicate runtime county FIPS.");
    assert(!row.processing_version?.startsWith("seed") && row.data_status !== "estimated", "Seeded runtime features are forbidden.");
    ids.add(row.location_id);
  }
  const evidenceDir = path.join(root, releasePath, "evidence");
  directory(evidenceDir);
  const names = fs.readdirSync(evidenceDir).sort();
  assert(names.length === COUNTY_COUNT, "Runtime county evidence partitions are incomplete.");
  const tree = createHash("sha256");
  let evidenceCount = 0;
  for (const name of names) {
    assert(/^county-\d{5}\.json$/.test(name) && ids.has(name.slice(0, -5)), "Unexpected county evidence partition.");
    const bytes = readFile(path.join(evidenceDir, name), 256 * 1024);
    tree.update(name + "\0" + sha256(bytes) + "\n");
    const rows = JSON.parse(bytes);
    assert(Array.isArray(rows) && rows.length > 0 && rows.every(row => row.location_id === name.slice(0, -5)
      && typeof row.metric_name === "string" && !row.source_url?.startsWith("local://") && row.status !== "estimated"),
    "Invalid or seeded county evidence.");
    evidenceCount += rows.length;
  }
  assert(evidenceCount === EVIDENCE_COUNT && tree.digest("hex") === evidenceTreeSha,
    "Pinned county evidence count/checksum does not match.");
  const files = ["manifest.json", `${releasePath}/manifest.json`, `${releasePath}/location_features.json`,
    ...names.map(name => `${releasePath}/evidence/${name}`)].sort();
  return { release_id: RELEASE_ID, data_mode: "public_data", county_count: COUNTY_COUNT,
    evidence_count: evidenceCount, files, manifest_sha256: manifestSha, features_sha256: featuresSha,
    evidence_tree_sha256: evidenceTreeSha };
}

export async function buildRuntimeBundle(source, outputDir) {
  const validated = validateRuntimeData(source);
  fs.mkdirSync(outputDir, { recursive: true });
  const filename = `runtime-data-${RELEASE_ID}.tar.gz`;
  const temporary = fs.mkdtempSync(path.join(outputDir, ".bundle-"));
  try {
    const archive = path.join(temporary, filename);
    await tar.create({ cwd: source, file: archive, prefix: "feature_store", gzip: { level: 9 }, portable: true,
      mtime: new Date(0), noPax: true, noDirRecurse: true, strict: true }, validated.files);
    validateRuntimeData(source);
    const checksum = await fileSha256(archive);
    const destination = path.join(outputDir, filename);
    if (fs.existsSync(destination)) assert(await fileSha256(destination) === checksum,
      "Refusing to overwrite a different existing runtime bundle.");
    else fs.renameSync(archive, destination);
    const metadata = { bundle_format: 1, filename, archive_bytes: fs.statSync(destination).size, sha256: checksum,
      release_id: RELEASE_ID, data_mode: validated.data_mode, county_count: COUNTY_COUNT,
      evidence_count: EVIDENCE_COUNT, file_count: validated.files.length,
      manifest_sha256: manifestSha, features_sha256: featuresSha, evidence_tree_sha256: evidenceTreeSha,
      attribution: "Source: WRI Aqueduct 4.0 (https://www.wri.org/aqueduct/faq), CC BY 4.0; access dates and transformations retained in county evidence. Other official source attribution is retained in the original manifests/evidence." };
    fs.writeFileSync(destination + ".sha256", `${checksum}  ${filename}\n`);
    fs.writeFileSync(destination + ".metadata.json", JSON.stringify(metadata, null, 2) + "\n");
    return { ...metadata, archive_path: destination };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

function byteLimit(maximum) {
  let bytes = 0;
  return new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    callback(bytes > maximum ? new Error("Runtime bundle exceeds the permitted size.") : null, chunk);
  } });
}
// node-tar's parser uses abort(), not the destroy() contract expected by pipeline.
function archiveSink(parser) {
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      try { if (parser.write(chunk)) callback(); else parser.once("drain", callback); }
      catch (error) { callback(error); }
    },
    final(callback) {
      parser.once("finish", callback);
      try { parser.end(); } catch (error) { callback(error); }
    },
    destroy(error, callback) {
      if (error) parser.abort(error);
      callback(error);
    }
  });
  parser.on("error", error => sink.destroy(error));
  return sink;
}
const archivePrefix = `feature_store/${releasePath}`;
function allowedEntry(name, entry) {
  if (name.includes("\\") || name.startsWith("/") || name.split("/").includes("..")) return false;
  if (entry.type === "Directory") return new Set(["feature_store", "feature_store/releases", archivePrefix,
    `${archivePrefix}/evidence`]).has(name.replace(/\/$/, ""));
  if (entry.type !== "File" || !Number.isSafeInteger(entry.size) || entry.size < 0) return false;
  if (["feature_store/manifest.json", `${archivePrefix}/manifest.json`].includes(name)) return entry.size <= 64 * 1024;
  if (name === `${archivePrefix}/location_features.json`) return entry.size <= 32 * 1024 * 1024;
  return new RegExp(`^${archivePrefix}/evidence/county-\\d{5}\\.json$`).test(name) && entry.size <= 256 * 1024;
}

export async function validateArchive(archive) {
  const names = new Set();
  let fileCount = 0;
  const parser = tar.list({ strict: true, onReadEntry(entry) {
    const name = entry.path.replace(/\/$/, "");
    if (!allowedEntry(entry.path, entry) || names.has(name)) parser.abort(new Error("Unsafe or duplicate runtime archive entry."));
    else { names.add(name); if (entry.type === "File") fileCount++; }
    entry.resume();
  } });
  await pipeline(fs.createReadStream(archive), createGunzip(), byteLimit(maxExpandedBytes), archiveSink(parser));
  assert(fileCount === COUNTY_COUNT + 3 && names.has("feature_store/manifest.json")
    && names.has(`${archivePrefix}/manifest.json`) && names.has(`${archivePrefix}/location_features.json`),
  "Runtime archive does not contain the complete minimal store.");
}

function downloadUrl(value) {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  assert(!url.username && !url.password && (url.protocol === "https:" || url.protocol === "http:" && loopback),
    "Runtime bundle URL must be HTTPS (loopback HTTP is allowed for local tests only).");
  return url;
}

export async function restoreRuntimeData({ dataDir, url, checksum }) {
  assert(path.isAbsolute(dataDir) && path.dirname(dataDir) !== dataDir, "DATA_DIR must be an absolute dedicated directory.");
  if (fs.existsSync(dataDir)) {
    assert(fs.lstatSync(dataDir).isDirectory(), "DATA_DIR must not be a symlink or file.");
    try { return { ...validateRuntimeData(dataDir), restored: false }; } catch { /* Validate replacement before changing the current directory. */ }
  }
  assert(url, "Runtime data is absent or invalid; RUNTIME_DATA_URL is required. No seeded fallback will be used.");
  assert(typeof checksum === "string" && /^[a-f0-9]{64}$/i.test(checksum), "RUNTIME_DATA_SHA256 is required for a download.");
  const sourceUrl = downloadUrl(url);
  fs.mkdirSync(path.dirname(dataDir), { recursive: true, mode: 0o700 });
  const temporary = fs.mkdtempSync(path.join(path.dirname(dataDir), ".runtime-restore-"));
  try {
    const partial = path.join(temporary, "runtime.tar.gz.part");
    try {
      const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(120000) });
      assert(response.ok && response.body, "Runtime bundle download failed.");
      downloadUrl(response.url);
      assert(Number(response.headers.get("Content-Length") ?? 0) <= maxDownloadBytes, "Runtime bundle download is too large.");
      await pipeline(Readable.fromWeb(response.body), byteLimit(maxDownloadBytes), fs.createWriteStream(partial, { flags: "wx", mode: 0o600 }));
    } catch { throw new Error("Runtime bundle download failed, was oversized, or timed out."); }
    assert(await fileSha256(partial) === checksum.toLowerCase(), "Runtime bundle SHA-256 mismatch; active data was not changed.");
    await validateArchive(partial);
    const extracted = path.join(temporary, "extracted");
    fs.mkdirSync(extracted, { mode: 0o700 });
    await pipeline(fs.createReadStream(partial), createGunzip(), byteLimit(maxExpandedBytes),
      archiveSink(tar.extract({ cwd: extracted, strict: true, preservePaths: false, filter: allowedEntry })));
    const candidate = path.join(extracted, "feature_store");
    const validated = validateRuntimeData(candidate);
    let backup;
    if (fs.existsSync(dataDir)) {
      backup = `${dataDir}.invalid-${randomUUID()}`;
      fs.renameSync(dataDir, backup);
    }
    try { fs.renameSync(candidate, dataDir); }
    catch (error) { if (backup) fs.renameSync(backup, dataDir); throw error; }
    return { ...validated, restored: true, ...(backup ? { preserved_invalid_store: backup } : {}) };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
