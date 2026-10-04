const base = process.env.APP_URL ?? "http://localhost:3000";
const response = await fetch(new URL("/api/project/status", base), { method: "POST", signal: AbortSignal.timeout(75000) });
if (!response.ok) throw new Error("Provider verification endpoint returned HTTP " + response.status);
const result = await response.json();
console.log(JSON.stringify(result, null, 2));
if (!result.fallback_passed || result.verification === "live_failed_fallback_available") process.exitCode = 1;
