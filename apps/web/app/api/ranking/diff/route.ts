import { z } from "zod";
import { projectSchema } from "@/lib/llm/schemas";
import { cloneProject } from "@/lib/project/defaults";
import { rankingDiff } from "@/lib/backend/ranking-diff";
import { requireCompleteProject } from "@/lib/backend/decisions";
import { apiResult } from "@/lib/backend/http";

export const runtime = "nodejs";
const schema = z.strictObject({ before_project: projectSchema, after_project: projectSchema,
  location_ids: z.array(z.string().regex(/^county-\d{5}$/)).max(100).refine((ids) => new Set(ids).size === ids.length).optional(),
  top_n: z.number().int().min(1).max(100).optional() });
export function POST(request: Request) {
  return apiResult(async () => {
    const body = schema.parse(await request.json());
    const before = cloneProject(body.before_project), after = cloneProject(body.after_project);
    requireCompleteProject(before); requireCompleteProject(after);
    return rankingDiff(before, after, body.location_ids, body.top_n);
  });
}
