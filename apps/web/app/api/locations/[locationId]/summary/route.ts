import { z } from "zod";
import { apiResult } from "@/lib/backend/http";
import { requireCompleteProject, selectedLocation } from "@/lib/backend/decisions";
import { decisionTrace } from "@/lib/decision-engine/decision-trace";
import { getStoreSnapshot } from "@/lib/data/store";
import { cloneProject } from "@/lib/project/defaults";
import { audienceSchema, projectSchema } from "@/lib/llm/schemas";
import { buildSummaryFacts } from "@/lib/llm/location-summary";
import { getLLMProvider, LocalDeterministicProvider } from "@/lib/llm/provider";
import { locationSummaryCache, summaryCacheKey } from "@/lib/llm/summary-cache";

export const runtime = "nodejs";
const schema = z.strictObject({ project: projectSchema, audience: audienceSchema.optional(), revision: z.number().int().positive().optional() });
export function POST(request: Request, context: { params: Promise<{ locationId: string }> }) {
  return apiResult(async () => {
    const body = schema.parse(await request.json()), project = cloneProject(body.project);
    requireCompleteProject(project);
    const { locationId } = await context.params, snapshot = getStoreSnapshot();
    const trace = decisionTrace(project, locationId, snapshot), { location } = selectedLocation(project, locationId, snapshot);
    const audience = body.audience ?? "developer";
    const facts = buildSummaryFacts(trace, project, location.county_name, location.state_code);
    const provider = getLLMProvider();
    const result = await locationSummaryCache.get(summaryCacheKey(trace, audience, body.revision), () =>
      provider.generateLocationSummary ? provider.generateLocationSummary(facts, audience) : new LocalDeterministicProvider().generateLocationSummary(facts, audience));
    return { summary: result.value, provider: result.status };
  });
}
