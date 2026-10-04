import type { CategoryKey, DecisionWeights, ProjectState } from "@/lib/types/domain";

export const categoryLabels: Record<CategoryKey, string> = {
  energy: "Power & Clean Energy",
  water: "Water Resilience",
  climate: "Climate Resilience",
  infrastructure: "Infrastructure & Land",
  economics: "Economics",
  approval: "Approval Readiness",
  community: "Community Readiness"
};

export const defaultWeights: DecisionWeights = {
  energy: 0.25,
  water: 0.2,
  climate: 0.15,
  infrastructure: 0.15,
  economics: 0.1,
  approval: 0.1,
  community: 0.05
};

export const defaultProject: ProjectState = {
  geography: { country: "US", states: [] },
  weights: defaultWeights,
  constraints: [],
  activePrioritySignals: [],
  compareLocationIds: []
};

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function cloneProject(project?: Partial<ProjectState>): ProjectState {
  return {
    ...defaultProject,
    ...project,
    geography: { ...project?.geography, country: "US", states: [...(project?.geography?.states ?? [])],
      ...(project?.geography?.regions ? { regions: [...project.geography.regions] } : {}) },
    weights: { ...defaultWeights, ...(project?.weights ?? {}) },
    constraints: [...(project?.constraints ?? [])],
    activePrioritySignals: [...(project?.activePrioritySignals ?? [])],
    compareLocationIds: [...(project?.compareLocationIds ?? [])]
  };
}
