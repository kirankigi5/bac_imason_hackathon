import { httpFailure, LLMRequestError, type StructuredTransport } from "./openai-transport";

export class OpenRouterTransport implements StructuredTransport {
  constructor(private key: string, private model: string, private timeoutMs = 20000) {}

  async complete(instructions: string, input: unknown, schema: Record<string, unknown>, name: string): Promise<unknown> {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", signal: AbortSignal.timeout(this.timeoutMs),
        headers: { Authorization: "Bearer " + this.key, "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, stream: false, max_tokens: 2200,
          provider: { require_parameters: true },
          messages: [{ role: "system", content: instructions }, { role: "user", content: JSON.stringify(input) }],
          response_format: { type: "json_schema", json_schema: { name, strict: true, schema } } })
      });
      if (!response.ok) throw await httpFailure(response);
      const body = await response.json() as { error?: unknown;
        choices?: Array<{ finish_reason?: string; error?: unknown; message?: { content?: unknown; refusal?: unknown } }> } | null;
      if (!body || body.error) throw new LLMRequestError("http_error");
      if (!Array.isArray(body.choices) || body.choices.length !== 1) throw new LLMRequestError("invalid_json");
      const choice = body.choices[0];
      if (choice?.error || choice?.finish_reason === "error") throw new LLMRequestError("http_error");
      if (choice?.message?.refusal || choice?.finish_reason === "content_filter") throw new LLMRequestError("refused");
      if (choice?.finish_reason !== "stop") throw new LLMRequestError("partial_response");
      if (typeof choice.message?.content !== "string") throw new LLMRequestError("invalid_json");
      return JSON.parse(choice.message.content);
    } catch (error) {
      if (error instanceof LLMRequestError) throw error;
      if (error instanceof SyntaxError) throw new LLMRequestError("invalid_json");
      if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new LLMRequestError("timeout");
      throw new LLMRequestError("network_error");
    }
  }
}
