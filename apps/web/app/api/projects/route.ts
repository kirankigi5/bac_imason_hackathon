import { z } from "zod";
import { projectSchema } from "@/lib/llm/schemas";
import { createProject, projectWithFreshness } from "@/lib/project/persistence";
import { getProjectRepository } from "@/lib/project/repository";
import { apiResult } from "@/lib/backend/http";

export const runtime = "nodejs";
const schema = z.strictObject({ name: z.string().trim().min(1).max(120), project: projectSchema.optional(),
  source: z.enum(["api", "chat", "filters"]).optional(), user_message: z.string().max(6000).optional() });
export function POST(request: Request) {
  return apiResult(async () => {
    const body = schema.parse(await request.json());
    return createProject(body.name, body.project, { source: body.source ?? "api", user_message: body.user_message });
  }, 201);
}
export function GET() { return apiResult(() => ({ projects: getProjectRepository().list().map((row) => projectWithFreshness(row)), limit: 50 })); }
