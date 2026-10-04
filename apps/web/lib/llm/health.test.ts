// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloneProject } from "@/lib/project/defaults";
import { OpenAIResponsesTransport } from "./openai-transport";
import { OpenRouterTransport } from "./openrouter-transport";
import { getLLMProvider, getProviderStatus, StructuredLLMProvider } from "./provider";
import { getLLMHealth, resetLLMHealth } from "./health";
import { verifyLLMProvider } from "./verification";
import { GET as statusGET, POST as statusPOST } from "@/app/api/project/status/route";

const secret = "fixture-secret-not-a-real-key";
const intent = { capacity_mw: 500, workload_type: "AI_TRAINING", geography: { country: "US", states: [], regions: [] },
  target_go_live_year: 2030, planning_horizon_year: null,
  priority_changes: [{ factor: "water", importance: "HIGH", direction: null }],
  constraints_to_add: [], constraints_to_remove: [], action: "update_project", question: "why_here", audience: null, clarification: null };
const openAIResponse = (value: unknown) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
const routerResponse = (value: unknown) => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] });
const geminiResponse = (value: unknown) => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] });
function validOutput(body: Record<string, unknown>) {
  const text = "input" in body ? body.input as string : "contents" in body
    ? (body.contents as Array<{ parts: Array<{ text: string }> }>)[0].parts[0].text
    : (body.messages as Array<{ content: string }>)[1].content;
  const input = JSON.parse(text);
  if (input.message) return intent;
  const evidence = input.facts.find((fact: { id: string }) => fact.id.startsWith("evidence:"));
  const change = input.facts.find((fact: { id: string }) => fact.id.startsWith("change:county:"));
  return { fact_ids: ["recommendation", evidence.id, ...(change ? [change.id] : [])] };
}
beforeEach(() => {
  resetLLMHealth(); vi.stubEnv("LLM_PROVIDER", "openai"); vi.stubEnv("LLM_MODEL", "fixture-model");
  vi.stubEnv("LLM_API_KEY", ""); vi.stubEnv("OPENAI_API_KEY", secret); vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", ""); vi.stubEnv("GOOGLE_API_KEY", "");
});
afterEach(() => { resetLLMHealth(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("provider availability, transport validation and fallback", () => {
  it.each(["openai", "openrouter", "gemini"])("verifies all three operations through the %s HTTP adapter", async (provider) => {
    if (provider === "openrouter") { vi.stubEnv("LLM_PROVIDER", provider); vi.stubEnv("OPENAI_API_KEY", ""); vi.stubEnv("OPENROUTER_API_KEY", secret); }
    if (provider === "gemini") { vi.stubEnv("LLM_PROVIDER", provider); vi.stubEnv("LLM_MODEL", "gemini-fixture"); vi.stubEnv("GEMINI_API_KEY", secret); }
    const network = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string), value = validOutput(body);
      return new Response(JSON.stringify(provider === "openai" ? openAIResponse(value) : provider === "gemini" ? geminiResponse(value) : routerResponse(value)));
    });
    vi.stubGlobal("fetch", network); expect(getLLMHealth().status).toBe("unverified");
    const result = await verifyLLMProvider();
    expect(result.verification).toBe("live_verified"); expect(result.fallback_passed).toBe(true); expect(network).toHaveBeenCalledTimes(3);
    expect(Object.values(result.operations).every((operation) => operation.mode === "llm" && operation.passed)).toBe(true);
    expect(result.provider.available).toBe(true); expect(result.provider.health!.status).toBe("available");
    expect(JSON.stringify(result)).not.toContain(secret);
    for (const [url, options] of network.mock.calls) {
      expect(url).toBe(provider === "openai" ? "https://api.openai.com/v1/responses" : provider === "gemini"
        ? "https://generativelanguage.googleapis.com/v1beta/models/gemini-fixture:generateContent" : "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(options.body as string); expect(body).not.toHaveProperty("api_key"); expect(body).not.toHaveProperty("tools");
      if (provider === "openai") { expect(body.store).toBe(false); expect(body.text.format.strict).toBe(true); }
      else if (provider === "gemini") {
        expect((options.headers as Record<string, string>)["x-goog-api-key"]).toBe(secret);
        expect(body.generationConfig.responseFormat.text.mimeType).toBe("APPLICATION_JSON");
        expect(body.generationConfig.responseFormat.text.schema.additionalProperties).toBe(false);
        expect(url).not.toContain(secret); expect(options.body).not.toContain(secret);
      }
      else { expect(body.response_format.json_schema.strict).toBe(true); expect(body.provider.require_parameters).toBe(true); }
    }
  });
  it("works with no key and exercises all three fallback operations without networking", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const network = vi.fn(() => { throw new Error("No-key verification must not call the network"); }); vi.stubGlobal("fetch", network);
    const result = await verifyLLMProvider();
    expect(result.verification).toBe("skipped_no_credentials"); expect(result.fallback_passed).toBe(true);
    expect(Object.values(result.operations).every((operation) => operation.mode === "fallback")).toBe(true);
    expect(result.provider.health!.status).toBe("disabled"); expect(network).not.toHaveBeenCalled();
  });
  it("enforces the transport timeout and restores parsing through deterministic fallback", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      const signal = options.signal!;
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })));
    const transport = new OpenAIResponsesTransport(secret, "fixture", 5);
    const provider = new StructuredLLMProvider(transport);
    const output = await provider.parseProjectIntent("700 MW instead", cloneProject());
    expect(output.status.mode).toBe("fallback"); expect(output.value.update.capacityMw).toBe(700);
    expect(getLLMHealth().operations.parse_project_intent?.failure_code).toBe("timeout");
    expect(getProviderStatus().available).toBe(false);
  });
  it.each([
    ["invalid_json", { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "{broken" }] }] }],
    ["partial_response", { status: "incomplete", output: [] }],
    ["refused", { status: "completed", output: [{ type: "message", content: [{ type: "refusal" }] }] }],
    ["invalid_json", { status: "completed", output: {} }],
    ["invalid_json", { status: "completed", output: [{ type: "message", content: null }] }]
  ])("rejects %s Responses output and records a safe health code", async (code, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    const output = await getLLMProvider().parseProjectIntent("700 MW instead", cloneProject());
    expect(output.status.mode).toBe("fallback"); expect(output.value.update.capacityMw).toBe(700);
    expect(getLLMHealth().operations.parse_project_intent?.failure_code).toBe(code);
  });
  it.each([
    ["partial_response", { choices: [{ finish_reason: "length", message: { content: "{}" } }] }],
    ["refused", { choices: [{ finish_reason: "content_filter", message: { content: null } }] }],
    ["http_error", { error: { code: 503, message: secret } }],
    ["invalid_json", { choices: [{ finish_reason: "stop", message: { content: "{broken" } }] }]
  ])("rejects %s OpenRouter output without rendering raw errors", async (code, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(new OpenRouterTransport(secret, "fixture").complete("", {}, {}, "fixture")).rejects.toMatchObject({ code });
  });
  it("records HTTP status without echoing credentials or provider error messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: secret } }), { status: 429 })));
    await getLLMProvider().parseProjectIntent("700 MW instead", cloneProject());
    const status = await statusGET(); expect(status.headers.get("cache-control")).toBe("no-store");
    const output = await status.json(); expect(output.health.operations.parse_project_intent.failure_code).toBe("http_error:429");
    expect(JSON.stringify(output)).not.toContain(secret); expect(output.available).toBe(false);
  });
  it("resets verified health when credentials or model change", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(openAIResponse(intent)))));
    await getLLMProvider().parseProjectIntent("500 MW AI training in the US by 2030 with low water risk", cloneProject());
    expect(getLLMHealth().status).toBe("available");
    vi.stubEnv("OPENAI_API_KEY", "different-fixture-key"); expect(getLLMHealth().status).toBe("unverified");
    vi.stubEnv("LLM_MODEL", "different-fixture-model"); expect(getLLMHealth().operations).toEqual({});
  });
  it("distinguishes exhausted billing from rate limiting without retrying", async () => {
    const network = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "credit_balance_exhausted", message: secret } }), { status: 429 }));
    vi.stubGlobal("fetch", network);
    const result = await getLLMProvider().parseProjectIntent("700 MW instead", cloneProject());
    expect(result.status.mode).toBe("fallback"); expect(network).toHaveBeenCalledTimes(1);
    expect(getLLMHealth().operations.parse_project_intent?.failure_code).toBe("http_error:429:credit_balance_exhausted");
    expect(JSON.stringify(getProviderStatus())).not.toContain(secret);
  });
  it("does not enable billable production verification without an explicit flag", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("ALLOW_LLM_VERIFICATION", "0");
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    expect((await statusPOST()).status).toBe(403); expect(network).not.toHaveBeenCalled();
  });
});
