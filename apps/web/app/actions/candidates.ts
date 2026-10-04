"use server";

import { z } from "zod";
import { projectSchema } from "@/lib/llm/schemas";
import { cloneProject } from "@/lib/project/defaults";
import { getProjectRepository } from "@/lib/project/repository";
import { DecisionError, getRanking, projectHash, requireCompleteProject } from "@/lib/backend/decisions";
import type { ProjectState, RankedLocation, RankingVersions } from "@/lib/types/domain";

export type CandidatesRequest = { project: ProjectState; projectId?: string; revision?: number; mode: "ranked" | "excluded" };
export type CandidatesData = RankingVersions & { results: RankedLocation[] };
export type CandidatesResponse = { ok: true; data: CandidatesData } | { ok: false; error: string };
const schema = z.strictObject({ project: projectSchema, projectId: z.uuid().optional(), revision: z.number().int().positive().optional(),
  mode: z.enum(["ranked", "excluded"]) }).refine((body) => !!body.projectId === (body.revision !== undefined), "Saved projects require both ID and revision");

export async function loadCandidates(input: CandidatesRequest): Promise<CandidatesResponse> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid candidate project profile." };
  try {
    const project = cloneProject(parsed.data.project);
    requireCompleteProject(project);
    if (parsed.data.projectId) {
      const saved = getProjectRepository().get(parsed.data.projectId);
      if (saved.revision !== parsed.data.revision || projectHash(saved.project) !== projectHash(project)) {
        return { ok: false, error: "Project revision or criteria changed; reload saved state before browsing candidates." };
      }
    }
    const ranking = getRanking(project);
    const results = parsed.data.mode === "ranked" ? ranking.results : ranking.excluded.filter((row) =>
      !project.geography?.states?.length || project.geography.states.includes(row.state_code));
    return { ok: true, data: { results, data_release_id: ranking.data_release_id,
      scoring_version: ranking.scoring_version, normalization_version: ranking.normalization_version } };
  } catch (error) {
    return { ok: false, error: error instanceof DecisionError ? error.message : "Could not load candidates from the feature store. Please retry." };
  }
}
