import { getEvidenceForLocation, getStoreSnapshot } from "@/lib/data/store";
import { getRanking, versionsFor } from "@/lib/backend/decisions";
import { buildExplanationPayload } from "@/lib/decision-engine/explanations";
import { computeRankingChanges } from "@/lib/decision-engine/ranking-changes";
import { cloneProject } from "@/lib/project/defaults";
import { describeProjectChanges, setCategoryWeight } from "@/lib/project/state";
import { finalizeIntent } from "./intent-parser";
import { getLLMProvider, getProviderStatus } from "./provider";
import { llmConfigured } from "./health";
import { observeLLM } from "./health";

export async function verifyLLMProvider() {
  const provider = getLLMProvider();
  const parsed = await provider.parseProjectIntent("I need a 500 MW AI training facility in the US by 2030 with low water risk.", cloneProject());
  const intent = finalizeIntent(parsed.value, cloneProject());
  const parsingPassed = intent.readyToSearch && intent.project.capacityMw === 500 && intent.project.workloadType === "AI_TRAINING"
    && intent.project.geography?.country === "US" && intent.project.targetGoLiveYear === 2030;
  if (!parsingPassed && parsed.status.mode === "llm") observeLLM("parse_project_intent", false, "semantic_verification_failed");
  // An invalid remote interpretation must not prevent exercising the real engine.
  const project = parsingPassed ? intent.project : cloneProject({ capacityMw: 500, workloadType: "AI_TRAINING",
    geography: { country: "US" }, targetGoLiveYear: 2030, activePrioritySignals: ["water"] });
  const snapshot = getStoreSnapshot();
  const before = getRanking(project, snapshot);
  const location = before.results[0];
  const evidence = getEvidenceForLocation(location.location_id, snapshot);
  const payload = buildExplanationPayload(project, location, evidence, before.results);
  payload.versions = versionsFor(snapshot);
  const explanation = await provider.generateExplanation(payload, "developer");
  const afterProject = cloneProject(project);
  afterProject.weights = setCategoryWeight(project.weights, "water", project.weights.water + .08);
  const after = getRanking(afterProject, snapshot);
  const selected = after.results.find((row) => row.location_id === location.location_id)!;
  const changePayload = buildExplanationPayload(afterProject, selected, evidence, after.results);
  changePayload.versions = versionsFor(snapshot);
  changePayload.question = "ranking_change";
  changePayload.rankingChange = computeRankingChanges(project, afterProject, [...before.results, ...before.excluded],
    [...after.results, ...after.excluded], describeProjectChanges(project, afterProject), selected.location_id);
  const change = await provider.generateExplanation(changePayload, "developer");
  const operations = {
    parse_project_intent: { passed: parsingPassed, mode: parsed.status.mode },
    explain_location: { passed: explanation.value.includes(location.county_name) && explanation.value.includes("Real site power capacity"), mode: explanation.status.mode },
    explain_ranking_change: { passed: change.value.includes("rank ") && change.value.includes(" to ") && change.value.includes("same feature release"), mode: change.status.mode }
  };
  const fallbackPassed = Object.values(operations).every((row) => row.passed);
  return { verification: !llmConfigured() ? "skipped_no_credentials" : fallbackPassed && Object.values(operations).every((row) => row.mode === "llm") ? "live_verified" : "live_failed_fallback_available",
    fallback_passed: fallbackPassed, operations, provider: getProviderStatus() };
}
