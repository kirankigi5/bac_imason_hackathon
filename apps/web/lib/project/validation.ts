import type { ProjectState } from "@/lib/types/domain";

export function getMissingRequiredFields(project: ProjectState): string[] {
  const missing: string[] = [];
  if (!project.capacityMw) missing.push("capacity");
  if (!project.workloadType) missing.push("workload_type");
  if (!project.targetGoLiveYear) missing.push("target_go_live_year");
  if (project.activePrioritySignals.length === 0 && project.constraints.length === 0) {
    missing.push("priorities_or_constraints");
  }
  return missing;
}

export function getFollowupQuestion(missing: string[]): string | null {
  const first = missing[0];
  if (!first) return null;
  const questions: Record<string, string> = {
    capacity: "What capacity are you targeting in MW?",
    workload_type: "Will this primarily support AI training, inference, a mix, or general cloud workloads?",
    target_go_live_year: "What target go-live year should I use?",
    priorities_or_constraints: "Which priority should matter most first: clean energy, water resilience, grid readiness, climate risk, speed of approval, or cost?"
  };
  return questions[first] ?? "What else should I know before ranking locations?";
}
