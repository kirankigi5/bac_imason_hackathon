import { z } from "zod";
import { projectSchema } from "@/lib/llm/schemas";
import { getProjectRepository } from "@/lib/project/repository";
import { projectWithFreshness, updateProject } from "@/lib/project/persistence";
import { apiResult } from "@/lib/backend/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const schema = z.strictObject({ expected_revision: z.number().int().positive(), name: z.string().trim().min(1).max(120).optional(),
  project: projectSchema.optional(), source: z.enum(["api", "chat", "filters"]).optional(), user_message: z.string().max(6000).optional() });
export function GET(_request: Request, context: Context) {
  return apiResult(async () => projectWithFreshness(getProjectRepository().get(z.uuid().parse((await context.params).id))));
}
export function PATCH(request: Request, context: Context) {
  return apiResult(async () => {
    const body = schema.parse(await request.json()), id = z.uuid().parse((await context.params).id);
    return updateProject(id, body.expected_revision, body.project ?? {}, body.name, { source: body.source ?? "api", user_message: body.user_message });
  });
}
