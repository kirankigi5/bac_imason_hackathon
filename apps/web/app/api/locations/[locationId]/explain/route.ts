import { NextResponse } from "next/server";
import { getEvidenceForLocation, getStoreSnapshot } from "@/lib/data/store";
import { buildExplanationPayload } from "@/lib/decision-engine/explanations";
import { getRanking, versionsFor } from "@/lib/backend/decisions";
import { decisionTrace } from "@/lib/decision-engine/decision-trace";
import { getLLMProvider } from "@/lib/llm/provider";
import { cloneProject } from "@/lib/project/defaults";
import { z } from "zod";
import { audienceSchema, projectSchema, questionSchema } from "@/lib/llm/schemas";
import { getFollowupQuestion, getMissingRequiredFields } from "@/lib/project/validation";
import { computeRankingChanges } from "@/lib/decision-engine/ranking-changes";
import { describeProjectChanges } from "@/lib/project/state";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ locationId: string }> }) {
  const validated = z.strictObject({ project: projectSchema.optional(), audience: audienceSchema.optional(),
    question: questionSchema.optional(), previousProject: projectSchema.optional(),
    comparisonLocationId: z.string().regex(/^county-\d{5}$/).optional() }).safeParse(await request.json().catch(() => null));
  if (!validated.success) return NextResponse.json({ error: "Invalid explanation request" }, { status: 400 });
  const body = validated.data;
  const project = cloneProject(body.project);
  const missing = getMissingRequiredFields(project);
  if (missing.length) return NextResponse.json({ error: "Complete the project profile first", followupQuestion: getFollowupQuestion(missing) }, { status: 422 });
  const audience = body.audience ?? "developer";
  const { locationId } = await context.params;
  const snapshot = getStoreSnapshot();
  const ranked = getRanking(project, snapshot);
  const all = [...ranked.results, ...ranked.excluded];
  const location = all.find((item) => item.location_id === locationId);

  if (!location) {
    return NextResponse.json({ error: "Location not found" }, { status: 404 });
  }
  if (body.comparisonLocationId && !all.some((item) => item.location_id === body.comparisonLocationId)) {
    return NextResponse.json({ error: "Comparison location not found" }, { status: 404 });
  }

  const evidence = getEvidenceForLocation(location.location_id, snapshot);
  const payload = buildExplanationPayload(project, location, evidence, ranked.results);
  payload.versions = versionsFor(snapshot);
  payload.question = body.question ?? "why_here";
  payload.comparison = all.find((item) => item.location_id === body.comparisonLocationId && item.location_id !== locationId);
  if (body.previousProject && getMissingRequiredFields(cloneProject(body.previousProject)).length === 0) {
    const previous = cloneProject(body.previousProject);
    const old = getRanking(previous, snapshot);
    payload.rankingChange = computeRankingChanges(previous, project, [...old.results, ...old.excluded], all, describeProjectChanges(previous, project), locationId);
  }
  const provider = getLLMProvider();
  const explanation = await provider.generateExplanation(payload, audience);

  return NextResponse.json({
    explanation: explanation.value,
    payload,
    provider: explanation.status,
    ...versionsFor(snapshot), decision_trace: decisionTrace(project, locationId, snapshot)
  }, { headers: { "Cache-Control": "no-store" } });
}
