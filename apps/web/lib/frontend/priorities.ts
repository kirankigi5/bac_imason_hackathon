import { categoryKeys, type DecisionWeights } from "@/lib/types/domain";
import { normalizeWeights } from "@/lib/project/state";
import { z } from "zod";

export const priorityStorageKey = "scoring-priority-inputs-v1";
const values = (max: number) => z.strictObject(Object.fromEntries(categoryKeys.map((factor) => [factor, z.number().min(0).max(max)])) as Record<typeof categoryKeys[number], z.ZodNumber>);
const storedScale = z.object({ weights: values(1), priorities: values(100) });

// Canonical projects store relative weights, not an absolute priority scale.
// Reconstruct equivalent inputs with the highest priority at 100.
export function prioritiesFromWeights(weights: DecisionWeights): DecisionWeights {
  const highest = Math.max(...categoryKeys.map((factor) => weights[factor]));
  return Object.fromEntries(categoryKeys.map((factor) => [factor, highest > 0 ? weights[factor] / highest * 100 : 0])) as DecisionWeights;
}
export function weightsFromPriorities(priorities: DecisionWeights): DecisionWeights {
  if (!Object.values(priorities).some((value) => value > 0)) throw new Error("At least one priority must be above Ignore.");
  return normalizeWeights(priorities);
}
export function readPriorities(weights: DecisionWeights): DecisionWeights {
  try {
    const saved = storedScale.parse(JSON.parse(window.localStorage.getItem(priorityStorageKey) ?? "null"));
    const equivalent = weightsFromPriorities(saved.priorities);
    if (categoryKeys.every((factor) => Math.abs(saved.weights[factor] - weights[factor]) < 0.00015
      && Math.abs(equivalent[factor] - weights[factor]) < 0.00015)) return saved.priorities;
  } catch { /* Saved scales are optional; canonical weights remain authoritative. */ }
  return prioritiesFromWeights(weights);
}
export function rememberPriorities(weights: DecisionWeights, priorities: DecisionWeights) {
  try { window.localStorage.setItem(priorityStorageKey, JSON.stringify({ weights, priorities })); } catch { /* No browser storage is required to edit priorities. */ }
}
export function priorityImportance(value: number): string {
  return value === 0 ? "Ignore" : value < 40 ? "Low" : value < 65 ? "Medium" : value <= 80 ? "High" : value < 100 ? "Very High" : "Highest";
}
