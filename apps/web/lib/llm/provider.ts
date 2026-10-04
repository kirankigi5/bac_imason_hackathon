import { z } from "zod";
import type { Audience, ExplanationPayload, ParsedIntent, ProjectState, ProviderStatus } from "@/lib/types/domain";
import { explanationFacts, renderFacts, selectLocalFacts } from "@/lib/decision-engine/explanation-facts";
import { finalizeIntent, parseContextualIntent, parseLocalIntent } from "./intent-parser";
import { intentSchema, validatedIntent } from "./schemas";
import { explanationPrompt, intentPrompt } from "./prompts";
import { LLMRequestError, OpenAIResponsesTransport, type StructuredTransport } from "./openai-transport";
import { OpenRouterTransport } from "./openrouter-transport";
import { GeminiTransport } from "./gemini-transport";
import { getLLMHealth, llmConfigured, llmCredentials, observeLLM } from "./health";
import { getMissingRequiredFields } from "@/lib/project/validation";
import { renderSummary, summaryPrompt, summarySelectionSchema, summarySentences, type SummaryFacts } from "./location-summary";

export type ProviderResult<T> = { value: T; status: ProviderStatus };
export interface LLMProvider {
  parseProjectIntent(message: string, currentProject: ProjectState): Promise<ProviderResult<ParsedIntent>>;
  generateExplanation(payload: ExplanationPayload, audience: Audience): Promise<ProviderResult<string>>;
  generateLocationSummary?(facts: SummaryFacts, audience: Audience): Promise<ProviderResult<string>>;
}

function failureCode(error: unknown) {
  return error instanceof LLMRequestError ? error.code + (error.httpStatus ? ":" + error.httpStatus : "")
    + (error.providerCode ? ":" + error.providerCode : "") : "invalid_output";
}

export class LocalDeterministicProvider implements LLMProvider {
  constructor(private reason = "LLM disabled or credentials unavailable") {}
  async parseProjectIntent(message: string, currentProject: ProjectState): Promise<ProviderResult<ParsedIntent>> {
    return { value: parseLocalIntent(message, currentProject), status: this.status() };
  }
  async generateExplanation(payload: ExplanationPayload, audience: Audience): Promise<ProviderResult<string>> {
    const facts = explanationFacts(payload);
    return { value: renderFacts(facts, selectLocalFacts(payload, facts, audience), audience), status: this.status() };
  }
  async generateLocationSummary(facts: SummaryFacts, audience: Audience): Promise<ProviderResult<string>> {
    return { value: renderSummary(facts, audience), status: this.status() };
  }
  private status(): ProviderStatus { return { provider: "local", mode: "fallback", reason: this.reason }; }
}

export class StructuredLLMProvider implements LLMProvider {
  constructor(private transport: StructuredTransport, private name = "openai",
    private fallback: LLMProvider = new LocalDeterministicProvider("LLM response failed validation or request failed")) {}
  async parseProjectIntent(message: string, currentProject: ProjectState): Promise<ProviderResult<ParsedIntent>> {
    const contextual = parseContextualIntent(message, currentProject);
    if (contextual) return { value: contextual, status: { provider: "engine", mode: "fallback", reason: "Contextual intake answer parsed deterministically" } };
    // Resolve explicit contradictions even if a remote model overlooked them.
    const local = parseLocalIntent(message, currentProject);
    if (local.action === "explain") return { value: local,
      status: { provider: "engine", mode: "fallback", reason: "Explanation question routed deterministically" } };
    if (local.clarification) return this.fallback.parseProjectIntent(message, currentProject);
    try {
      const raw = intentSchema.parse(await this.transport.complete(intentPrompt, { message, currentProject,
        active_followup: getMissingRequiredFields(currentProject)[0] ?? null }, z.toJSONSchema(intentSchema), "project_intent"));
      const value = validatedIntent(raw);
      const inIntake = getMissingRequiredFields(currentProject).length > 0;
      // Explicit profile answers must survive even when intake is only partially complete.
      for (const field of ["capacityMw", "workloadType", "targetGoLiveYear", "planningHorizonYear", "geography"] as const) {
        if (local.update[field] !== undefined && JSON.stringify(local.update[field]) !== JSON.stringify(value.update[field] ?? currentProject[field])) {
          throw new Error("Extraction lost or changed an explicit profile answer");
        }
        if (inIntake && local.update[field] === undefined && currentProject[field] !== undefined && value.update[field] !== undefined
          && JSON.stringify(value.update[field]) !== JSON.stringify(currentProject[field])) {
          throw new Error("Extraction changed an accepted intake field without an explicit update");
        }
      }
      const explicitPriorities = (local.update.priorityChanges ?? []).map((item) => item.factor).sort();
      const extractedPriorities = (value.update.priorityChanges ?? []).map((item) => item.factor).sort();
      const gridMisclassifiedAsEnergy = explicitPriorities.includes("infrastructure") && !explicitPriorities.includes("energy")
        && extractedPriorities.includes("energy");
      const cleanEnergyMisclassifiedAsInfrastructure = explicitPriorities.includes("energy") && !explicitPriorities.includes("infrastructure")
        && extractedPriorities.includes("infrastructure");
      if (gridMisclassifiedAsEnergy || cleanEnergyMisclassifiedAsInfrastructure) {
        throw new Error("Extraction changed an explicit priority factor");
      }
      const completedClarification = raw.clarification === "capacity" && !!currentProject.capacityMw
        || raw.clarification === "workload" && !!currentProject.workloadType
        || raw.clarification === "year" && !!currentProject.targetGoLiveYear
        || raw.clarification === "geography";
      if (value.clarification && !local.clarification && completedClarification) {
        throw new Error("Extraction requested clarification for an accepted or optional field");
      }
      // Hard requirements must match an explicit supported limit, not a model's
      // interpretation of a soft preference. Rejected extractions fall back whole.
      if (value.update.constraintsToAdd?.some((constraint) => !local.update.constraintsToAdd?.some((explicit) =>
        constraint.id === explicit.id && constraint.metric === explicit.metric && constraint.operator === explicit.operator && constraint.value === explicit.value))
        || value.update.constraintsToRemove?.some((id) => !local.update.constraintsToRemove?.includes(id))) {
        throw new Error("Extraction introduced an unrequested hard-constraint change");
      }
      if (inIntake && finalizeIntent(local, currentProject).readyToSearch
        && !finalizeIntent(value, currentProject).readyToSearch) {
        throw new Error("Extraction lost a complete explicit project profile");
      }
      observeLLM("parse_project_intent", true);
      return { value, status: { provider: this.name, mode: "llm" } };
    } catch (error) {
      observeLLM("parse_project_intent", false, failureCode(error));
      const result = await this.fallback.parseProjectIntent(message, currentProject);
      return { ...result, status: { ...result.status, available: false, health: getLLMHealth() } };
    }
  }
  async generateExplanation(payload: ExplanationPayload, audience: Audience): Promise<ProviderResult<string>> {
    const facts = explanationFacts(payload);
    const schema = z.strictObject({ fact_ids: z.array(z.string()).min(1).max(30) });
    try {
      const output = schema.parse(await this.transport.complete(explanationPrompt,
        { audience, question: payload.question ?? "why_here", payload, facts }, z.toJSONSchema(schema), "grounded_explanation"));
      if (!output.fact_ids.includes("recommendation") || !output.fact_ids.some((id) => id.startsWith("evidence:"))) {
        throw new Error("Explanation omitted grounded evidence or recommendation context");
      }
      if (payload.question === "ranking_change" && payload.rankingChange &&
          !output.fact_ids.some((id) => id.startsWith("change:county:"))) throw new Error("Explanation omitted computed ranking deltas");
      if ((payload.question === "why_not_second" || payload.question === "outrank") &&
          (payload.comparison || payload.nearestAlternatives.length) && !output.fact_ids.includes("comparison")) throw new Error("Explanation omitted the computed comparison");
      const value = renderFacts(facts, output.fact_ids, audience);
      observeLLM(payload.question === "ranking_change" ? "explain_ranking_change" : "explain_location", true);
      return { value, status: { provider: this.name, mode: "llm" } };
    } catch (error) {
      observeLLM(payload.question === "ranking_change" ? "explain_ranking_change" : "explain_location", false,
        failureCode(error));
      const result = await this.fallback.generateExplanation(payload, audience);
      return { ...result, status: { ...result.status, available: false, health: getLLMHealth() } };
    }
  }
  async generateLocationSummary(facts: SummaryFacts, audience: Audience): Promise<ProviderResult<string>> {
    try {
      const output = summarySelectionSchema.parse(await this.transport.complete(summaryPrompt,
        { audience, facts, sentences: summarySentences(facts, audience) }, z.toJSONSchema(summarySelectionSchema), "location_summary"));
      const value = renderSummary(facts, audience, output.sentence_ids);
      observeLLM("explain_location", true);
      return { value, status: { provider: this.name, mode: "llm" } };
    } catch (error) {
      observeLLM("explain_location", false, failureCode(error));
      const result = await new LocalDeterministicProvider("Concise explanation unavailable or invalid; using grounded fallback").generateLocationSummary(facts, audience);
      return { ...result, status: { ...result.status, available: false, health: getLLMHealth() } };
    }
  }
}

export function getLLMProvider(): LLMProvider {
  const provider = process.env.LLM_PROVIDER ?? "local";
  if (provider === "local") return new LocalDeterministicProvider();
  const key = llmCredentials();
  const model = process.env.LLM_MODEL;
  if (!["openai", "openrouter", "gemini"].includes(provider) || !key || !model) {
    return new LocalDeterministicProvider("Set LLM_PROVIDER=openai, openrouter or gemini, LLM_MODEL and the matching server-side API key to enable the LLM");
  }
  if (provider === "gemini") return new StructuredLLMProvider(new GeminiTransport(key, model), "gemini");
  if (provider === "openrouter") return new StructuredLLMProvider(new OpenRouterTransport(key, model), "openrouter");
  return new StructuredLLMProvider(new OpenAIResponsesTransport(key, model));
}

export function getProviderStatus(): ProviderStatus {
  const enabled = llmConfigured();
  const health = getLLMHealth();
  return enabled ? { provider: process.env.LLM_PROVIDER!, mode: health.status === "degraded" ? "fallback" : "llm", available: health.status === "available", health,
    reason: health.status === "unverified" ? "Configured, but no live provider operation has been verified" : health.status === "degraded" ? "A provider operation failed; deterministic fallback remains available" : "Provider operation succeeded; see per-operation verification status" }
    : { provider: "local", mode: "fallback", available: false, health, reason: "LLM credentials or model configuration unavailable; using deterministic parsing and explanations" };
}
