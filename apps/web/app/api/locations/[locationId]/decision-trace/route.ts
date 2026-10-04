import { z } from "zod";
import { projectSchema } from "@/lib/llm/schemas";
import { cloneProject } from "@/lib/project/defaults";
import { decisionTrace } from "@/lib/decision-engine/decision-trace";
import { DecisionError, requireCompleteProject } from "@/lib/backend/decisions";
import { apiResult } from "@/lib/backend/http";
import { getProjectRepository } from "@/lib/project/repository";

export const runtime = "nodejs";
const inputSchema = z.union([z.strictObject({ project: projectSchema }), z.strictObject({ project_id: z.uuid() })]);
type Context = { params: Promise<{ locationId: string }> };
async function trace(body: unknown, context: Context) {
  const input = inputSchema.parse(body);
  const project = cloneProject("project" in input ? input.project : getProjectRepository().get(input.project_id).project);
  const id = z.string().regex(/^county-\d{5}$/).parse((await context.params).locationId);
  requireCompleteProject(project);
  return decisionTrace(project, id);
}
export function POST(request: Request, context: Context) { return apiResult(async () => trace(await request.json(), context)); }
export function GET(request: Request, context: Context) {
  return apiResult(() => {
    const query = new URL(request.url).searchParams;
    if (query.has("project_id") && query.has("project")) throw new DecisionError(400, "Supply project or project_id, not both");
    if (query.has("project_id") && !query.has("project")) return trace({ project_id: query.get("project_id") }, context);
    const serialized = z.string().min(2).max(16000).parse(query.get("project"));
    return trace({ project: JSON.parse(serialized) }, context);
  });
}
