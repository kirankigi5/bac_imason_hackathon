export interface StructuredTransport {
  complete(instructions: string, input: unknown, schema: Record<string, unknown>, name: string): Promise<unknown>;
}
export class LLMRequestError extends Error {
  constructor(public code: "timeout" | "http_error" | "invalid_json" | "partial_response" | "refused" | "network_error",
    public httpStatus?: number, public providerCode?: string) { super(code === "partial_response" ? "LLM response incomplete" : "LLM request failed: " + code); }
}

const safeProviderCodes = new Set(["insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded", "organization_usage_limit_exceeded", "rate_limit_exceeded", "slow_down",
  "invalid_api_key", "model_not_found", "server_is_overloaded", "RESOURCE_EXHAUSTED", "PERMISSION_DENIED",
  "UNAUTHENTICATED", "INVALID_ARGUMENT", "NOT_FOUND", "UNAVAILABLE", "INTERNAL", "FAILED_PRECONDITION", "DEADLINE_EXCEEDED"]);
export async function httpFailure(response: Response): Promise<LLMRequestError> {
  try {
    const body = await response.json() as { error?: { code?: unknown; status?: unknown } } | null;
    const code = typeof body?.error?.code === "string" ? body.error.code : body?.error?.status;
    return new LLMRequestError("http_error", response.status, typeof code === "string" && safeProviderCodes.has(code) ? code : undefined);
  } catch { return new LLMRequestError("http_error", response.status); }
}

export class OpenAIResponsesTransport implements StructuredTransport {
  constructor(private key: string, private model: string, private timeoutMs = 20000) {}

  async complete(instructions: string, input: unknown, schema: Record<string, unknown>, name: string): Promise<unknown> {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST", signal: AbortSignal.timeout(this.timeoutMs),
        headers: { "Authorization": "Bearer " + this.key, "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, store: false, instructions,
          input: JSON.stringify(input), max_output_tokens: 2200,
          text: { format: { type: "json_schema", name, strict: true, schema } } })
      });
      if (!response.ok) throw await httpFailure(response);
      const body = await response.json() as {
        status?: string; output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
      } | null;
      if (!body || body.status !== "completed") throw new LLMRequestError("partial_response");
      if (!Array.isArray(body.output)) throw new LLMRequestError("invalid_json");
      const messages = body.output.filter((item) => item?.type === "message");
      if (messages.some((item) => !Array.isArray(item.content))) throw new LLMRequestError("invalid_json");
      const content = messages.flatMap((item) => item.content ?? []);
      if (content.some((item) => item?.type === "refusal")) throw new LLMRequestError("refused");
      const output = content.filter((item) => item?.type === "output_text").map((item) => item.text ?? "").join("");
      return JSON.parse(output);
    } catch (error) {
      if (error instanceof LLMRequestError) throw error;
      if (error instanceof SyntaxError) throw new LLMRequestError("invalid_json");
      if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new LLMRequestError("timeout");
      throw new LLMRequestError("network_error");
    }
  }
}
