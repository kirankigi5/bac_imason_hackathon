import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRuntimeData } from "./lib/runtime-data.mjs";
import { prepareDirectories, validateDeploymentConfig, verifyClientSecrets, verifyLiveApp, verifySqlite } from "./lib/deployment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const mode = process.argv[2];
  if (mode === "--http-only") {
    console.log(JSON.stringify(await verifyLiveApp(process.env.APP_URL || "http://127.0.0.1:3000"), null, 2));
  } else {
    const config = validateDeploymentConfig();
    prepareDirectories(config);
    if (mode === "--paths") console.log("Deployment paths and server-side configuration validated.");
    else {
      const data = validateRuntimeData(config.dataDir);
      verifySqlite(config.databasePath);
      verifyClientSecrets(path.join(root, "apps/web/.next/static"));
      const live = mode === "--startup" ? {} : await verifyLiveApp(process.env.APP_URL || `http://127.0.0.1:${config.port}`, config.provider);
      console.log(JSON.stringify({ verification: "passed", data_mode: data.data_mode, release_id: data.release_id,
        county_count: data.county_count, sqlite_writable: true, client_credentials_absent: true,
        server_provider: config.provider, remote_provider_configured: config.remoteProviderConfigured, ...live }, null, 2));
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
