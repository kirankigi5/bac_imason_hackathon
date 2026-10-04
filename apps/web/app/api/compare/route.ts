import { z } from "zod";
import { projectSchema } from "@/lib/llm/schemas";
import { cloneProject } from "@/lib/project/defaults";
import { comparison } from "@/lib/backend/comparison";
import { requireCompleteProject } from "@/lib/backend/decisions";
import { apiResult } from "@/lib/backend/http";

export const runtime = "nodejs";
const schema = z.strictObject({ project: projectSchema,
  location_ids: z.array(z.string().regex(/^county-\d{5}$/)).min(2).max(4).refine((ids) => new Set(ids).size === ids.length) });
export function POST(request: Request) {
  return apiResult(async () => {
    const body = schema.parse(await request.json());
    const project = cloneProject(body.project);
    requireCompleteProject(project);
    return comparison(project, body.location_ids);
  });
}
