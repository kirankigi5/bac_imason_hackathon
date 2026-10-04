import { z } from "zod";
import { getProjectRepository } from "@/lib/project/repository";
import { apiResult } from "@/lib/backend/http";

export const runtime = "nodejs";
export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return apiResult(async () => getProjectRepository().history(z.uuid().parse((await context.params).id)));
}
