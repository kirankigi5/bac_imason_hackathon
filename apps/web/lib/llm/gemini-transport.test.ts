// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloneProject } from "@/lib/project/defaults";
import { GeminiTransport } from "./gemini-transport";
import { getLLMHealth, llmCredentials, resetLLMHealth } from "./health";
import { getLLMProvider, getProviderStatus, StructuredLLMProvider } from "./provider";
import { finalizeIntent } from "./intent-parser";
import { verifyLLMProvider } from "./verification";

const secret = "fixture-gemini-secret-not-a-real-key";
const response = (text: string, finishReason = "STOP") => ({ candidates: [{ finishReason, content: { parts: [{ text }] } }] });
const intake = "I need a 500 MW AI training facility in the US by 2030 with low water risk.";
const validIntent = { capacity_mw: 500, workload_type: "AI_TRAINING", geography: { country: "US", states: [], regions: [] },
  target_go_live_year: 2030, planning_horizon_year: null, priority_changes: [{ factor: "water", importance: "HIGH", direction: null }],
  constraints_to_add: [], constraints_to_remove: [], action: "update_project", question: "why_here", audience: null, clarification: null };

beforeEach(() => {
  resetLLMHealth(); vi.stubEnv("LLM_PROVIDER", "gemini"); vi.stubEnv("LLM_MODEL", "gemini-fixture");
  vi.stubEnv("GEMINI_API_KEY", secret); vi.stubEnv("GOOGLE_API_KEY", ""); vi.stubEnv("LLM_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "unused-openai-fixture"); vi.stubEnv("OPENROUTER_API_KEY", "unused-router-fixture");
});
afterEach(() => { resetLLMHealth(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Gemini structured transport and safe fallback", () => {
  it("uses a fixed endpoint, header-only credentials and bounded structured output", async () => {
    const network = vi.fn().mockResolvedValue(new Response(JSON.stringify(response('{"ok":true}'))));
    vi.stubGlobal("fetch", network);
    const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
    expect(await new GeminiTransport(secret, "gemini-fixture").complete("Instructions", { county: "01001" }, schema, "fixture")).toEqual({ ok: true });
    const [url, options] = network.mock.calls[0]; const body = JSON.parse(options.body);
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-fixture:generateContent");
    expect(options.headers["x-goog-api-key"]).toBe(secret); expect(url).not.toContain(secret); expect(options.body).not.toContain(secret);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(body.systemInstruction.parts[0].text).toBe("Instructions");
    expect(JSON.parse(body.contents[0].parts[0].text)).toEqual({ county: "01001" });
    expect(body.generationConfig).toEqual({ candidateCount: 1, maxOutputTokens: 2200, temperature: 0,
      responseFormat: { text: { mimeType: "APPLICATION_JSON", schema } } });
    expect(body).not.toHaveProperty("tools");
  });
  it("ignores thought parts and parses only final text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: "STOP",
      content: { parts: [{ thought: true, text: "Internal thought" }, { text: '{"ok":' }, { text: "true}" }] } }] }))));
    expect(await new GeminiTransport(secret, "gemini-fixture").complete("", {}, {}, "fixture")).toEqual({ ok: true });
  });
  it.each([
    ["invalid_json", null],
    ["invalid_json", {}],
    ["invalid_json", { candidates: [] }],
    ["invalid_json", response("{broken")],
    ["invalid_json", { candidates: [{ finishReason: "STOP", content: { parts: null } }] }],
    ["invalid_json", { candidates: [{ finishReason: "STOP", content: { parts: [{ inlineData: {} }] } }] }],
    ["partial_response", response("{}", "MAX_TOKENS")],
    ["refused", response("{}", "SAFETY")],
    ["refused", { promptFeedback: { blockReason: "BLOCKLIST" }, candidates: [] }],
    ["http_error", { error: { message: secret } }]
  ])("rejects %s Gemini output and preserves deterministic parsing", async (code, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    const result = await getLLMProvider().parseProjectIntent("700 MW instead", cloneProject());
    expect(result.status.mode).toBe("fallback"); expect(result.value.update.capacityMw).toBe(700);
    expect(getLLMHealth().operations.parse_project_intent?.failure_code).toBe(code);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("does not trust syntactically valid JSON with an invalid intent schema", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(response('{"capacity_mw":"invented"}')))));
    const result = await getLLMProvider().parseProjectIntent("700 MW instead", cloneProject());
    expect(result.status.mode).toBe("fallback"); expect(result.value.update.capacityMw).toBe(700);
    expect(getLLMHealth().operations.parse_project_intent?.failure_code).toBe("invalid_output");
  });
  it("does not turn a soft water preference into a fabricated drought requirement", async () => {
    const value = { ...validIntent, priority_changes: [], constraints_to_add: [{ factor: "drought", operator: "<=", value: 60 }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(response(JSON.stringify(value))))));
    const result = await getLLMProvider().parseProjectIntent(intake, cloneProject());
    expect(result.status.mode).toBe("fallback"); expect(result.value.update.constraintsToAdd).toEqual([]);
    expect(result.value.update.priorityChanges).toContainEqual(expect.objectContaining({ factor: "water" }));
    expect(finalizeIntent(result.value, cloneProject()).readyToSearch).toBe(true);
  });
  it("rejects a changed hard threshold but accepts the explicitly supported limit", async () => {
    let calls = 0;
    const network = vi.fn(async () => new Response(JSON.stringify(response(JSON.stringify({ ...validIntent,
      constraints_to_add: [{ factor: "wildfire", operator: "<=", value: ++calls === 1 ? 65 : 60 }] })))));
    vi.stubGlobal("fetch", network);
    const first = await getLLMProvider().parseProjectIntent(intake + " Avoid high wildfire risk.", cloneProject());
    expect(first.status.mode).toBe("fallback"); expect(first.value.update.constraintsToAdd?.[0].value).toBe(60);
    const second = await getLLMProvider().parseProjectIntent(intake + " Avoid high wildfire risk.", cloneProject());
    expect(second.status.mode).toBe("llm"); expect(second.value.update.constraintsToAdd?.[0].value).toBe(60);
  });
  it.each([
    { ...validIntent, clarification: "priorities" },
    { ...validIntent, workload_type: null }
  ])("does not lose complete explicit intake fields or ask spurious clarification", async (value) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(response(JSON.stringify(value))))));
    const result = await getLLMProvider().parseProjectIntent(intake, cloneProject());
    expect(result.status.mode).toBe("fallback"); const finalized = finalizeIntent(result.value, cloneProject());
    expect(finalized.readyToSearch).toBe(true); expect(finalized.project.workloadType).toBe("AI_TRAINING");
  });
  it("rejects an unrequested removal of an existing hard constraint", async () => {
    const project = cloneProject({ constraints: [{ id: "fiber-min", metric: "raw_metrics.fiber_coverage_pct", operator: ">=", value: 90,
      label: "Minimum fiber coverage >= 90", kind: "hard" }] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(response(JSON.stringify({ ...validIntent, constraints_to_remove: ["fiber-min"] }))))));
    const result = await getLLMProvider().parseProjectIntent(intake, project);
    expect(result.status.mode).toBe("fallback"); expect(finalizeIntent(result.value, project).project.constraints).toEqual(project.constraints);
  });
  it("rejects invented evidence references for both explanation operations", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(response('{"fact_ids":["recommendation","evidence:invented","change:county:invented"]}')))));
    const result = await verifyLLMProvider();
    expect(result.verification).toBe("live_failed_fallback_available"); expect(result.fallback_passed).toBe(true);
    expect(result.operations.explain_location.mode).toBe("fallback"); expect(result.operations.explain_ranking_change.mode).toBe("fallback");
    expect(getLLMHealth().operations.explain_location?.failure_code).toBe("invalid_output");
    expect(getLLMHealth().operations.explain_ranking_change?.failure_code).toBe("invalid_output");
  });
  it("reports an allowlisted Google quota status without leaking its message or retrying", async () => {
    const network = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: secret } }), { status: 429 }));
    vi.stubGlobal("fetch", network); await getLLMProvider().parseProjectIntent("700 MW instead", cloneProject());
    expect(network).toHaveBeenCalledTimes(1);
    expect(getLLMHealth().operations.parse_project_intent?.failure_code).toBe("http_error:429:RESOURCE_EXHAUSTED");
    expect(JSON.stringify(getProviderStatus())).not.toContain(secret);
  });
  it("discards unrecognized provider error codes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: secret, status: secret, message: secret } }), { status: 403 })));
    await getLLMProvider().parseProjectIntent("700 MW instead", cloneProject());
    expect(getLLMHealth().operations.parse_project_intent?.failure_code).toBe("http_error:403");
    expect(JSON.stringify(getProviderStatus())).not.toContain(secret);
  });
  it("times out without making the deterministic engine unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      const signal = options.signal!;
      if (signal.aborted) reject(signal.reason); else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })));
    const result = await new StructuredLLMProvider(new GeminiTransport(secret, "gemini-fixture", 5), "gemini")
      .parseProjectIntent("700 MW instead", cloneProject());
    expect(result.status.mode).toBe("fallback"); expect(result.value.update.capacityMw).toBe(700);
    expect(getLLMHealth().operations.parse_project_intent?.failure_code).toBe("timeout");
  });
  it("rejects unsafe model identifiers before any network request", async () => {
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    await expect(new GeminiTransport(secret, "../models/other?key=" + secret).complete("", {}, {}, "fixture")).rejects.toMatchObject({ code: "invalid_json" });
    expect(network).not.toHaveBeenCalled();
  });
  it("does not borrow another provider's key when Gemini credentials are absent", async () => {
    vi.stubEnv("GEMINI_API_KEY", ""); const network = vi.fn(); vi.stubGlobal("fetch", network);
    const result = await verifyLLMProvider();
    expect(result.verification).toBe("skipped_no_credentials"); expect(result.fallback_passed).toBe(true);
    expect(Object.values(result.operations).every((operation) => operation.mode === "fallback")).toBe(true);
    expect(network).not.toHaveBeenCalled(); expect(getLLMHealth().status).toBe("disabled");
  });
  it("prioritizes the dedicated Gemini key and supports explicit server-side aliases", () => {
    vi.stubEnv("GOOGLE_API_KEY", "google-fixture"); vi.stubEnv("LLM_API_KEY", "generic-fixture");
    expect(llmCredentials()).toBe(secret); vi.stubEnv("GEMINI_API_KEY", ""); expect(llmCredentials()).toBe("google-fixture");
    vi.stubEnv("GOOGLE_API_KEY", ""); expect(llmCredentials()).toBe("generic-fixture");
  });
});
