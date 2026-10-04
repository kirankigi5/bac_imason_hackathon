import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRuntimeBundle } from "./lib/runtime-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const source = path.resolve(process.argv[2] ?? path.join(root, "data/feature_store"));
  const destination = path.resolve(process.argv[3] ?? path.join(root, "artifacts/runtime"));
  console.log(JSON.stringify(await buildRuntimeBundle(source, destination), null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
