import type { comparison } from "@/lib/backend/comparison";
import type { rankingDiff } from "@/lib/backend/ranking-diff";
import type { projectWithFreshness } from "@/lib/project/persistence";
import type { ProjectRepository } from "@/lib/project/repository";

// Type-only imports keep backend contracts aligned without shipping server code.
export type Comparison = ReturnType<typeof comparison>;
export type RankingDiff = ReturnType<typeof rankingDiff>;
export type SavedProject = ReturnType<typeof projectWithFreshness>;
export type ProjectHistory = ReturnType<ProjectRepository["history"]>;
