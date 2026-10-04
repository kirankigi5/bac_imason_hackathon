import { getEvidenceForLocation, getLocationFeatures, getStoreSnapshot } from "@/lib/data/store";
import { DecisionError, getRanking, versionsFor } from "@/lib/backend/decisions";
import { getProjectRepository } from "./repository";
import { updateProject } from "./persistence";
import { computeRankingChanges } from "@/lib/decision-engine/ranking-changes";
import { buildExplanationPayload, explainConciseFromPayload } from "@/lib/decision-engine/explanations";
import { getLLMProvider, type LLMProvider } from "@/lib/llm/provider";
import { finalizeIntent, isAcknowledgement, isGreeting, parseLocalIntent } from "@/lib/llm/intent-parser";
import { conversationSchema } from "@/lib/llm/schemas";
import type { ConversationResponse } from "@/lib/types/domain";
import { cloneProject } from "./defaults";
import { getMissingRequiredFields } from "./validation";
import { describeProjectChanges } from "./state";

export async function converse(body: unknown, provider: LLMProvider = getLLMProvider()): Promise<ConversationResponse> {
  const input = conversationSchema.parse(body);
  const saved = input.projectId ? getProjectRepository().get(input.projectId) : undefined;
  if (saved && input.expectedRevision !== saved.revision) throw new DecisionError(409, "Project revision changed; reload before updating");
  const current = cloneProject(saved && input.source !== "filters" ? saved.project : input.currentProject ?? saved?.project);
  if (input.source !== "filters" && getMissingRequiredFields(current).length === 0 && isAcknowledgement(input.message)) {
    const acknowledgement = finalizeIntent(parseLocalIntent(input.message, current), current);
    return { ...acknowledgement, assistantMessage: "You're welcome.", followupQuestion: null, readyToSearch: true,
      audience: input.audience ?? "developer", question: "why_here",
      provider: { provider: "engine", mode: "fallback", reason: "Acknowledgement; project left unchanged" } };
  }
  const localIntent = input.source === "filters" ? undefined : parseLocalIntent(input.message, current);
  if (localIntent && getMissingRequiredFields(current).length === 0 && localIntent.action !== "explain"
    && !localIntent.clarification && !hasProjectUpdate(localIntent.update)
    && !/^\s*(?:please\s+)?evaluate\s+(?:the\s+)?current\s+project[.!]?\s*$/i.test(input.message)) {
    const assistantMessage = isGreeting(input.message) ? "Hello! What would you like to change or ask about?"
      : `I'm not sure what you mean by "${input.message.trim()}". Could you clarify?`;
    return { ...finalizeIntent(localIntent, current), project: current, projectUpdate: {}, changes: [],
      assistantMessage, followupQuestion: null, clarification: assistantMessage, readyToSearch: false,
      audience: input.audience ?? "developer", question: "why_here",
      provider: { provider: "engine", mode: "fallback", reason: "No recognized project intent; project left unchanged" } };
  }
  const parsed = input.source === "filters"
    ? { value: { update: {}, action: "update_project" as const, question: "why_here" as const, clarification: null },
      status: { provider: "engine", mode: "fallback" as const, reason: "Filter values validated directly without LLM interpretation" } }
    : await provider.parseProjectIntent(input.message, current);
  const intent = parsed.value;
  const response: ConversationResponse = { ...finalizeIntent(intent, current),
    audience: intent.audience ?? input.audience ?? "developer", question: intent.question, provider: parsed.status };
  const snapshot = getStoreSnapshot();
  const finish = () => {
    if (saved && intent.action === "update_project" && !intent.clarification) {
      const persisted = updateProject(saved.id, saved.revision, response.project, undefined,
        { source: input.source ?? "chat", user_message: input.message }, snapshot);
      response.project_record = { id: persisted.id, revision: persisted.revision, updated_at: persisted.updated_at };
    } else if (saved) response.project_record = { id: saved.id, revision: saved.revision, updated_at: saved.updated_at };
    return response;
  };
  if (!response.readyToSearch) return finish();
  const features = getLocationFeatures(snapshot);
  const ranking = getRanking(response.project, snapshot);
  response.search = { project: response.project, results: ranking.results.slice(0, 20), excluded: ranking.excluded,
    feasibleCount: ranking.results.length, dataMode: snapshot.manifest.data_mode, ...versionsFor(snapshot) };
  const previous = saved && intent.action !== "explain" ? saved.project
    : input.previousProject ? cloneProject(input.previousProject) : intent.action === "explain" ? undefined : current;
  if (previous && getMissingRequiredFields(previous).length === 0) {
    const computedChanges = describeProjectChanges(previous, response.project);
    if (intent.action === "update_project") response.changes = computedChanges;
    const old = getRanking(previous, snapshot);
    response.rankingChange = computeRankingChanges(previous, response.project,
      [...old.results, ...old.excluded], [...ranking.results, ...ranking.excluded], computedChanges,
      input.selectedLocationId);
  }
  if (intent.action !== "explain") {
    response.assistantMessage = response.changes.length ? "Ranking refreshed."
      : "Evaluated the current project with the deterministic engine.";
    if (/fiber/i.test(input.message)) {
      const scoped = features.filter((row) => !response.project.geography?.states?.length
        || response.project.geography.states.includes(row.state_code));
      const missing = scoped.filter((row) => row.raw_metrics.fiber_coverage_pct == null).length;
      if (missing > 0) response.assistantMessage += missing === scoped.length
        ? " FCC fiber evidence is unavailable in the selected geography; fiber scores are not supplied. A hard fiber constraint excludes candidates with unknown evidence."
        : ` ${missing} counties in the selected geography lack FCC fiber evidence and cannot pass a hard fiber requirement. Available coverage is a mass-market proxy, not backbone capacity.`;
    }
    return finish();
  }
  const selected = [...ranking.results, ...ranking.excluded].find((row) => row.location_id === input.selectedLocationId)
    ?? ranking.results[0];
  if (!selected) {
    response.assistantMessage = "No counties satisfy the current constraints. Missing evidence cannot establish that a hard requirement is met.";
    return finish();
  }
  const payload = buildExplanationPayload(response.project, selected, getEvidenceForLocation(selected.location_id, snapshot), ranking.results);
  payload.versions = versionsFor(snapshot);
  payload.question = intent.question;
  payload.rankingChange = response.rankingChange;
  if (intent.question === "why_not_second") payload.comparison = ranking.results.find((row) => row.rank === 2 && row.location_id !== selected.location_id)
    ?? ranking.results.find((row) => row.location_id !== selected.location_id);
  if (intent.question === "outrank") payload.comparison = [...ranking.results, ...ranking.excluded].find((row) =>
    response.project.compareLocationIds.includes(row.location_id) && row.location_id !== selected.location_id) ?? payload.nearestAlternatives[0];
  const explanation = await provider.generateExplanation(payload, response.audience);
  response.assistantMessage = intent.question === "why_here" ? explainConciseFromPayload(payload, response.audience) : explanation.value;
  response.provider = explanation.status;
  response.explanationPayload = payload;
  return finish();
}

function hasProjectUpdate(update: ReturnType<typeof parseLocalIntent>["update"]): boolean {
  return update.capacityMw !== undefined || update.workloadType !== undefined || update.geography !== undefined
    || update.targetGoLiveYear !== undefined || update.planningHorizonYear !== undefined
    || !!update.priorityChanges?.length || !!update.constraintsToAdd?.length || !!update.constraintsToRemove?.length;
}
