import { httpFailure, LLMRequestError, type StructuredTransport } from "./openai-transport";

const blockedReasons = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "LANGUAGE"]);

export class GeminiTransport implements StructuredTransport {
  constructor(private key: string, private model: string, private timeoutMs = 20000) {}

  async complete(instructions: string, input: unknown, schema: Record<string, unknown>, _name: string): Promise<unknown> {
    try {
      if (!/^gemini-[a-z0-9.-]{1,100}$/.test(this.model)) throw new LLMRequestError("invalid_json");
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
        method: "POST", signal: AbortSignal.timeout(this.timeoutMs),
        headers: { "x-goog-api-key": this.key, "Content-Type": "application/json" },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: instructions }] },
          contents: [{ role: "user", parts: [{ text: JSON.stringify(input) }] }],
          generationConfig: { candidateCount: 1, maxOutputTokens: 2200, temperature: 0,
            responseFormat: { text: { mimeType: "APPLICATION_JSON", schema } } } })
      });
      if (!response.ok) throw await httpFailure(response);
      const body = await response.json() as { error?: unknown; promptFeedback?: { blockReason?: string };
        candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: unknown; thought?: boolean }> } }> } | null;
      if (!body || typeof body !== "object") throw new LLMRequestError("invalid_json");
      if (body.error) throw new LLMRequestError("http_error");
      if (body.promptFeedback?.blockReason && body.promptFeedback.blockReason !== "BLOCK_REASON_UNSPECIFIED") throw new LLMRequestError("refused");
      if (!Array.isArray(body.candidates) || body.candidates.length !== 1) throw new LLMRequestError("invalid_json");
      const candidate = body.candidates[0];
      if (blockedReasons.has(candidate?.finishReason ?? "")) throw new LLMRequestError("refused");
      if (candidate?.finishReason !== "STOP") throw new LLMRequestError("partial_response");
      const parts = candidate.content?.parts;
      if (!Array.isArray(parts) || parts.some((part) => !part || !part.thought && typeof part.text !== "string")) throw new LLMRequestError("invalid_json");
      const output = parts.filter((part) => !part.thought).map((part) => part.text as string).join("");
      return JSON.parse(output);
    } catch (error) {
      if (error instanceof LLMRequestError) throw error;
      if (error instanceof SyntaxError) throw new LLMRequestError("invalid_json");
      if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new LLMRequestError("timeout");
      throw new LLMRequestError("network_error");
    }
  }
}
