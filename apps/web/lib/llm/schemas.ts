import { z } from "zod";
import { categoryKeys, type ParsedIntent } from "@/lib/types/domain";
import { regionStates, stateAliases } from "@/lib/project/geography";

const states = z.enum(Object.values(stateAliases) as [string, ...string[]]);
const geography = z.strictObject({
  country: z.literal("US").optional(), states: z.array(states).max(51).optional(),
  regions: z.array(z.enum(Object.keys(regionStates) as [string, ...string[]])).max(5).optional()
});
export const constraintSchema = z.strictObject({
  id: z.enum(["wildfire-risk-max", "drought-risk-max", "water-resilience-min", "grid-readiness-min", "fiber-min", "grid-carbon-max"]),
  label: z.string().min(1).max(180),
  metric: z.enum(["raw_metrics.wildfire_risk_index", "raw_metrics.drought_risk_index", "category_scores.water", "grid_readiness_score", "raw_metrics.fiber_coverage_pct", "raw_metrics.grid_carbon_intensity_kgco2e_mwh"]),
  operator: z.enum(["<", "<=", ">", ">=", "="]), value: z.number().min(0).max(2000), kind: z.literal("hard")
});
export const projectSchema = z.strictObject({
  capacityMw: z.number().positive().max(100000).optional(),
  workloadType: z.enum(["AI_TRAINING", "AI_INFERENCE", "MIXED", "CLOUD"]).optional(),
  geography: geography.optional(), targetGoLiveYear: z.number().int().min(2026).max(2100).optional(),
  planningHorizonYear: z.number().int().min(2026).max(2100).optional(),
  weights: z.strictObject(Object.fromEntries(categoryKeys.map((key) => [key, z.number().min(0).max(1)])) as Record<typeof categoryKeys[number], z.ZodNumber>).optional(),
  constraints: z.array(constraintSchema).max(12).optional(), activePrioritySignals: z.array(z.enum(categoryKeys)).max(7).optional(),
  selectedLocationId: z.string().regex(/^county-\d{5}$/).optional(),
  compareLocationIds: z.array(z.string().regex(/^county-\d{5}$/)).max(4).refine((ids) => new Set(ids).size === ids.length).optional()
}).superRefine((project, context) => {
  if (project.weights && Object.values(project.weights).every((weight) => weight === 0)) context.addIssue({ code: "custom", message: "At least one weight must be positive", path: ["weights"] });
  const constraints = project.constraints ?? [];
  if (new Set(constraints.map((row) => row.id)).size !== constraints.length) context.addIssue({ code: "custom", message: "Duplicate constraints", path: ["constraints"] });
  for (const [index, row] of constraints.entries()) {
    const definition = Object.values(constraintDefinitions).find((item) => item.id === row.id)!;
    if (row.metric !== definition.metric || row.value > definition.max) context.addIssue({ code: "custom", message: "Constraint ID, metric or threshold mismatch", path: ["constraints", index] });
  }
}).transform((project) => ({ ...project, ...(project.constraints ? { constraints: project.constraints.map((row) => ({ ...row,
  label: `${Object.values(constraintDefinitions).find((item) => item.id === row.id)!.label} ${row.operator} ${row.value}` })) } : {}) }));
export const audienceSchema = z.enum(["developer", "government", "community"]);
export const questionSchema = z.enum(["why_here", "why_not_second", "risks", "trade_off", "outrank", "ranking_change"]);
export const conversationSchema = z.strictObject({
  message: z.string().trim().min(1).max(6000), currentProject: projectSchema.optional(),
  source: z.enum(["chat", "filters"]).optional(),
  audience: audienceSchema.optional(), selectedLocationId: z.string().regex(/^county-\d{5}$/).optional(),
  previousProject: projectSchema.optional(),
  projectId: z.uuid().optional(), expectedRevision: z.number().int().positive().optional()
}).superRefine((input, context) => {
  if (input.projectId && input.expectedRevision === undefined) context.addIssue({ code: "custom", message: "Saved conversations require expectedRevision", path: ["expectedRevision"] });
});

// All extraction fields are required and nullable: compatible with strict JSON
// outputs while distinguishing an omitted user answer from a requested update.
export const intentSchema = z.strictObject({
  capacity_mw: z.number().positive().max(100000).nullable(),
  workload_type: z.enum(["AI_TRAINING", "AI_INFERENCE", "MIXED", "CLOUD"]).nullable(),
  geography: z.strictObject({ country: z.literal("US"), states: z.array(states).max(51),
    regions: z.array(z.enum(Object.keys(regionStates) as [string, ...string[]])).max(5) }).nullable(),
  target_go_live_year: z.number().int().min(2026).max(2100).nullable(),
  planning_horizon_year: z.number().int().min(2026).max(2100).nullable(),
  priority_changes: z.array(z.strictObject({ factor: z.enum([...categoryKeys, "fiber"]),
    importance: z.enum(["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]).nullable(),
    direction: z.enum(["increase", "decrease"]).nullable() })).max(8),
  constraints_to_add: z.array(z.strictObject({ factor: z.enum(["wildfire", "drought", "water", "grid", "fiber", "carbon"]),
    operator: z.enum(["<", "<=", ">", ">=", "="]), value: z.number().min(0).max(2000) })).max(6),
  constraints_to_remove: z.array(constraintSchema.shape.id).max(6),
  action: z.enum(["update_project", "explain"]), question: questionSchema,
  audience: audienceSchema.nullable(),
  clarification: z.enum(["capacity", "workload", "geography", "year", "priorities", "contradiction"]).nullable()
});

export const constraintDefinitions = {
  wildfire: { id: "wildfire-risk-max", metric: "raw_metrics.wildfire_risk_index", label: "Maximum wildfire risk", max: 100 },
  drought: { id: "drought-risk-max", metric: "raw_metrics.drought_risk_index", label: "Maximum drought risk", max: 100 },
  water: { id: "water-resilience-min", metric: "category_scores.water", label: "Minimum water resilience", max: 100 },
  grid: { id: "grid-readiness-min", metric: "grid_readiness_score", label: "Minimum grid-readiness proxy", max: 100 },
  fiber: { id: "fiber-min", metric: "raw_metrics.fiber_coverage_pct", label: "Minimum fiber coverage", max: 100 },
  carbon: { id: "grid-carbon-max", metric: "raw_metrics.grid_carbon_intensity_kgco2e_mwh", label: "Maximum grid-carbon intensity", max: 2000 }
} as const;

export function validatedIntent(value: unknown): ParsedIntent {
  const raw = intentSchema.parse(value);
  const update: ParsedIntent["update"] = {};
  if (raw.capacity_mw !== null) update.capacityMw = raw.capacity_mw;
  if (raw.workload_type !== null) update.workloadType = raw.workload_type;
  if (raw.target_go_live_year !== null) update.targetGoLiveYear = raw.target_go_live_year;
  if (raw.planning_horizon_year !== null) update.planningHorizonYear = raw.planning_horizon_year;
  if (raw.geography) {
    const selected = [...new Set([...raw.geography.states, ...raw.geography.regions.flatMap((region) => regionStates[region])])];
    update.geography = { country: "US", states: selected.sort(),
      ...(raw.geography.regions.length ? { regions: raw.geography.regions } : {}) };
  }
  update.priorityChanges = raw.priority_changes.map((item) => {
    if (!item.importance && !item.direction) throw new Error("Priority update has no importance or direction");
    return { factor: item.factor === "fiber" ? "infrastructure" : item.factor,
      ...(item.importance ? { importance: item.importance } : {}), ...(item.direction ? { direction: item.direction } : {}) };
  });
  if (new Set(update.priorityChanges.map((item) => item.factor)).size !== update.priorityChanges.length) throw new Error("Contradictory duplicate priorities");
  update.constraintsToAdd = raw.constraints_to_add.map((item) => {
    const definition = constraintDefinitions[item.factor];
    if (item.value > definition.max) throw new Error("Constraint threshold exceeds metric scale");
    return { id: definition.id, metric: definition.metric, label: `${definition.label} ${item.operator} ${item.value}`, operator: item.operator, value: item.value, kind: "hard" };
  });
  if (new Set(update.constraintsToAdd.map((item) => item.id)).size !== update.constraintsToAdd.length) throw new Error("Contradictory duplicate constraints");
  update.constraintsToRemove = raw.constraints_to_remove;
  const clarifications = {
    capacity: "Which capacity should I use, in MW?", workload: "Should I use training, inference, a mix, or cloud?",
    geography: "This planner supports U.S. counties only; the current U.S. scope has been preserved.", year: "Which target go-live year should I use?",
    priorities: "Which of the conflicting priorities should I use?", contradiction: "Which of the conflicting instructions should I use?"
  };
  return { update: raw.action === "explain" || raw.clarification ? {} : update,
    action: raw.action, question: raw.question, audience: raw.audience ?? undefined,
    clarification: raw.clarification ? clarifications[raw.clarification] : null };
}
