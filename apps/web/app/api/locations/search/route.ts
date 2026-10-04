import { NextResponse } from "next/server";
import { getDataMode, getStoreSnapshot } from "@/lib/data/store";
import { getRanking } from "@/lib/backend/decisions";
import { cloneProject } from "@/lib/project/defaults";
import type { SearchResponse } from "@/lib/types/domain";
import { z } from "zod";
import { projectSchema } from "@/lib/llm/schemas";
import { getFollowupQuestion, getMissingRequiredFields } from "@/lib/project/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const validated = z.strictObject({ project: projectSchema.optional() }).safeParse(await request.json().catch(() => null));
  if (!validated.success) return NextResponse.json({ error: "Invalid project profile" }, { status: 400 });
  const project = cloneProject(validated.data.project);
  const missing = getMissingRequiredFields(project);
  if (missing.length) return NextResponse.json({ error: "Project intake is incomplete", missingRequiredFields: missing, followupQuestion: getFollowupQuestion(missing) }, { status: 422 });
  const snapshot = getStoreSnapshot();
  const ranked = getRanking(project, snapshot);
  const response: SearchResponse = {
    data_release_id: ranked.data_release_id, scoring_version: ranked.scoring_version, normalization_version: ranked.normalization_version,
    feasibleCount: ranked.results.length,
    results: ranked.results.slice(0, 20),
    excluded: ranked.excluded,
    project,
    dataMode: getDataMode(snapshot)
  };
  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
