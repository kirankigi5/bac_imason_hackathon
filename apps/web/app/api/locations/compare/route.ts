import { NextResponse } from "next/server";
import { comparison } from "@/lib/backend/comparison";
import { apiResult } from "@/lib/backend/http";
import { cloneProject } from "@/lib/project/defaults";
import { z } from "zod";
import { projectSchema } from "@/lib/llm/schemas";
import { getFollowupQuestion, getMissingRequiredFields } from "@/lib/project/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const validated = z.strictObject({ project: projectSchema.optional(),
    locationIds: z.array(z.string().regex(/^county-\d{5}$/)).min(1).max(4).refine((ids) => new Set(ids).size === ids.length) }).safeParse(await request.json().catch(() => null));
  if (!validated.success) return NextResponse.json({ error: "Invalid comparison profile or county IDs" }, { status: 400 });
  const body = validated.data;
  const project = cloneProject(body.project);
  const locationIds = body.locationIds;
  const missing = getMissingRequiredFields(project);
  if (missing.length) return NextResponse.json({ error: "Complete the project profile first", followupQuestion: getFollowupQuestion(missing) }, { status: 422 });

  return apiResult(() => comparison(project, locationIds));
}
