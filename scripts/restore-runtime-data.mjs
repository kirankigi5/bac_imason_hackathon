import fs from "node:fs";
import path from "node:path";
import { assert, restoreRuntimeData } from "./lib/runtime-data.mjs";

try {
  const dataDir = process.env.DATA_DIR ?? "";
  const databasePath = process.env.PROJECT_DB_PATH;
  if (databasePath) assert(path.isAbsolute(databasePath) && path.resolve(databasePath) !== path.resolve(dataDir)
    && !path.resolve(databasePath).startsWith(path.resolve(dataDir) + path.sep), "SQLite must use a separate absolute project-state path.");
  const result = await restoreRuntimeData({ dataDir, url: process.env.RUNTIME_DATA_URL,
    checksum: process.env.RUNTIME_DATA_SHA256 });
  if (databasePath) fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  console.log(JSON.stringify({ runtime_data: result.restored ? "restored" : "validated_existing",
    release_id: result.release_id, data_mode: result.data_mode, county_count: result.county_count,
    ...(result.preserved_invalid_store ? { invalid_previous_store_preserved: true } : {}) }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
