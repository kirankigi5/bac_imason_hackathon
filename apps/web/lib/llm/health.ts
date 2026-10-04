import { createHash } from "node:crypto";
import type { LLMHealth, LLMOperation } from "@/lib/types/domain";

let observed: { configuration: string; health: LLMHealth } | undefined;

export function llmCredentials() {
  if (process.env.LLM_PROVIDER === "gemini") return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.LLM_API_KEY;
  return process.env.LLM_API_KEY || (process.env.LLM_PROVIDER === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY);
}

function configuration() {
  // The credential fingerprint stays server-side and is never returned by status.
  return createHash("sha256").update(JSON.stringify([process.env.LLM_PROVIDER, process.env.LLM_MODEL,
    llmCredentials()])).digest("hex");
}
export function llmConfigured(): boolean {
  return ["openai", "openrouter", "gemini"].includes(process.env.LLM_PROVIDER ?? "") && !!process.env.LLM_MODEL && !!llmCredentials();
}
export function getLLMHealth(): LLMHealth {
  if (!llmConfigured()) return { status: "disabled", checked_at: null, last_success_at: null, operations: {} };
  if (observed?.configuration !== configuration()) return { status: "unverified", checked_at: null, last_success_at: null, operations: {} };
  return structuredClone(observed.health);
}
export function observeLLM(operation: LLMOperation, success: boolean, failureCode?: string) {
  const health = getLLMHealth();
  const timestamp = new Date().toISOString();
  health.operations[operation] = { success, checked_at: timestamp, ...(failureCode ? { failure_code: failureCode } : {}) };
  health.checked_at = timestamp;
  if (success) health.last_success_at = timestamp;
  health.status = Object.values(health.operations).some((row) => !row.success) ? "degraded" : "available";
  observed = { configuration: configuration(), health };
}
export function resetLLMHealth() { observed = undefined; }
