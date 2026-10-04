import { categoryKeys, type CategoryKey, type ChangeRecord, type DecisionWeights, type ProjectIntentUpdate, type ProjectState } from "@/lib/types/domain";
import { categoryLabels, cloneProject, defaultWeights } from "./defaults";

const targetWeights: Record<string, number> = {
  LOW: 0.06,
  MEDIUM: 0.13,
  HIGH: 0.22,
  VERY_HIGH: 0.32
};

export function normalizeWeights(weights: Partial<DecisionWeights>): DecisionWeights {
  const filled = categoryKeys.reduce((acc, key) => {
    acc[key] = Math.max(0, Number.isFinite(weights[key]) ? Number(weights[key]) : defaultWeights[key]);
    return acc;
  }, {} as DecisionWeights);
  const total = categoryKeys.reduce((sum, key) => sum + filled[key], 0);
  if (total <= 0) return { ...defaultWeights };
  return categoryKeys.reduce((acc, key) => {
    acc[key] = Number((filled[key] / total).toFixed(4));
    return acc;
  }, {} as DecisionWeights);
}

export function setCategoryWeight(weights: DecisionWeights, factor: CategoryKey, target: number): DecisionWeights {
  const clampedTarget = Math.min(0.6, Math.max(0, target));
  const remaining = Math.max(0.01, 1 - clampedTarget);
  const otherKeys = categoryKeys.filter((key) => key !== factor);
  const otherTotal = otherKeys.reduce((sum, key) => sum + weights[key], 0);
  const next = { ...weights, [factor]: clampedTarget };

  for (const key of otherKeys) {
    const share = otherTotal > 0 ? weights[key] / otherTotal : 1 / otherKeys.length;
    next[key] = share * remaining;
  }
  return normalizeWeights(next);
}

export function applyProjectUpdate(current: ProjectState, update: ProjectIntentUpdate): { project: ProjectState; changes: ChangeRecord[] } {
  const project = cloneProject(current);
  const changes: ChangeRecord[] = [];

  const setProfile = <K extends keyof ProjectState>(field: K, label: string, value: ProjectState[K]) => {
    const oldValue = project[field];
    if (value !== undefined && JSON.stringify(oldValue) !== JSON.stringify(value)) {
      changes.push({
        field: String(field),
        label,
        oldValue: stringifyValue(oldValue),
        newValue: stringifyValue(value),
        changeType: field === "geography" ? "geography" : "profile"
      });
      project[field] = value;
    }
  };

  setProfile("capacityMw", "Capacity", update.capacityMw);
  setProfile("workloadType", "Workload", update.workloadType);
  setProfile("geography", "Geography", update.geography);
  setProfile("targetGoLiveYear", "Target go-live year", update.targetGoLiveYear);
  setProfile("planningHorizonYear", "Planning horizon", update.planningHorizonYear);

  for (const priority of update.priorityChanges ?? []) {
    const oldWeight = project.weights[priority.factor];
    const target = priority.direction ? oldWeight + (priority.direction === "increase" ? 0.08 : -0.08)
      : priority.importance ? targetWeights[priority.importance] : oldWeight;
    project.weights = setCategoryWeight(project.weights, priority.factor, target);
    if (!project.activePrioritySignals.includes(priority.factor)) {
      project.activePrioritySignals.push(priority.factor);
    }
  }

  if (update.constraintsToRemove?.length) {
    for (const id of update.constraintsToRemove) {
      const existing = project.constraints.find((constraint) => constraint.id === id);
      project.constraints = project.constraints.filter((constraint) => constraint.id !== id);
      if (existing) {
        changes.push({
          field: "constraints",
          label: existing.label,
          oldValue: existing.label,
          newValue: null,
          changeType: "constraint"
        });
      }
    }
  }

  for (const constraint of update.constraintsToAdd ?? []) {
    const existing = project.constraints.find((item) => item.id === constraint.id);
    if (!existing || JSON.stringify(existing) !== JSON.stringify(constraint)) {
      project.constraints = [...project.constraints.filter((item) => item.id !== constraint.id), constraint];
      changes.push({
        field: "constraints",
        label: constraint.label,
        oldValue: existing ? `${existing.metric} ${existing.operator} ${existing.value}` : null,
        newValue: `${constraint.metric} ${constraint.operator} ${constraint.value}`,
        changeType: "constraint"
      });
    }
  }

  if (update.priorityChanges?.length) project.weights = normalizeWeights(project.weights);
  for (const factor of categoryKeys) {
    if (Math.abs(current.weights[factor] - project.weights[factor]) > 0.0001) {
      changes.push({ field: `weights.${factor}`, label: categoryLabels[factor], changeType: "weight",
        oldValue: `${Math.round(current.weights[factor] * 100)}%`, newValue: `${Math.round(project.weights[factor] * 100)}%` });
    }
  }
  return { project, changes };
}

function stringifyValue(value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function describeProjectChanges(before: ProjectState, after: ProjectState): ChangeRecord[] {
  const changes: ChangeRecord[] = [];
  const fields = { capacityMw: "Capacity", workloadType: "Workload", geography: "Geography",
    targetGoLiveYear: "Target go-live year", planningHorizonYear: "Planning horizon" } as const;
  for (const [field, label] of Object.entries(fields)) {
    const key = field as keyof typeof fields;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes.push({ field, label,
      oldValue: stringifyValue(before[key]), newValue: stringifyValue(after[key]), changeType: key === "geography" ? "geography" : "profile" });
  }
  for (const factor of categoryKeys) if (before.weights[factor] !== after.weights[factor]) changes.push({
    field: "weights." + factor, label: categoryLabels[factor], changeType: "weight",
    oldValue: `${Math.round(before.weights[factor] * 100)}%`, newValue: `${Math.round(after.weights[factor] * 100)}%` });
  const ids = new Set([...before.constraints, ...after.constraints].map((item) => item.id));
  for (const id of ids) {
    const old = before.constraints.find((item) => item.id === id), next = after.constraints.find((item) => item.id === id);
    if (JSON.stringify(old) !== JSON.stringify(next)) changes.push({ field: "constraints", label: next?.label ?? old!.label,
      changeType: "constraint", oldValue: old ? `${old.metric} ${old.operator} ${old.value}` : null,
      newValue: next ? `${next.metric} ${next.operator} ${next.value}` : null });
  }
  return changes;
}
