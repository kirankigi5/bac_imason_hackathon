import { applyProjectUpdate } from "@/lib/project/state";
import { getFollowupQuestion, getMissingRequiredFields } from "@/lib/project/validation";
import { regionStates, stateAliases } from "@/lib/project/geography";
import type { CategoryKey, ParsedIntent, ParseIntentResponse, ProjectState } from "@/lib/types/domain";
import { constraintDefinitions, intentSchema, validatedIntent } from "./schemas";
import type { z } from "zod";

export function finalizeIntent(intent: ParsedIntent, currentProject: ProjectState): ParseIntentResponse {
  const { project, changes } = applyProjectUpdate(currentProject, intent.clarification ? {} : intent.update);
  const missingRequiredFields = getMissingRequiredFields(project);
  const followupQuestion = intent.clarification ?? getFollowupQuestion(missingRequiredFields);
  return {
    project, projectUpdate: intent.update, changes, missingRequiredFields, followupQuestion,
    clarification: intent.clarification, readyToSearch: !followupQuestion,
    assistantMessage: followupQuestion ? "I need one detail before making a recommendation."
      : changes.length ? "Updated the project profile." : "The project profile is ready."
  };
}

export function parseProjectIntent(message: string, currentProject: ProjectState): ParseIntentResponse {
  return finalizeIntent(parseLocalIntent(message, currentProject), currentProject);
}

export function extractIntentUpdate(message: string, currentProject: ProjectState) {
  return parseLocalIntent(message, currentProject).update;
}

const capacityAnswer = /^(?:(?:around|roughly|about|approximately)\s+)?(\d+(?:\.\d+)?)\s*(?:mw|megawatts?|gw|gigawatts?)?[.!]?$/i;
const nationwideAnswer = /^(?:all|all (?:supported )?(?:u\.?s\.? )?(?:states|counties)|nationwide|anywhere(?: in (?:the )?(?:us|u\.s\.|united states))?)[.!]?$/i;
export const isAcknowledgement = (message: string) => /^(?:thanks?|thank you|ok(?:ay)?|sounds good|looks good|good)[.!]?$/i.test(message.trim());
export const isGreeting = (message: string) => /^(?:hello|hi|hey)[.!]?$/i.test(message.trim());

export function parseContextualIntent(message: string, currentProject: ProjectState): ParsedIntent | null {
  const text = message.trim();
  const activeField = getMissingRequiredFields(currentProject)[0];
  const contextual = activeField === "capacity" && capacityAnswer.test(text)
    || activeField === "workload_type" && /^(?:(?:ai|mostly|primarily)\s+)?(?:training|inference|mixed|mix|both|(?:general )?cloud)[.!]?$/i.test(text)
    || activeField === "workload_type" && nationwideAnswer.test(text)
    || activeField === "target_go_live_year" && /^(?:(?:by|in|around|roughly|about)\s+)?(?:20\d{2}|2100)[.!]?$/i.test(text)
    || nationwideAnswer.test(text)
    || isAcknowledgement(text)
    || isGreeting(text);
  return contextual ? parseLocalIntent(message, currentProject) : null;
}

export function parseLocalIntent(message: string, currentProject: ProjectState): ParsedIntent {
  const text = message.toLowerCase();
  const activeField = getMissingRequiredFields(currentProject)[0];
  const value: z.infer<typeof intentSchema> = {
    capacity_mw: null, workload_type: null, geography: null, target_go_live_year: null,
    planning_horizon_year: null, priority_changes: [], constraints_to_add: [], constraints_to_remove: [],
    action: "update_project", question: "why_here", audience: null, clarification: null
  };
  if (/explain|why |biggest risks|trade.off|outrank|ranking change/i.test(text)) {
    value.action = "explain";
    value.question = /ranking.*chang|rank.*chang|why.*chang/.test(text) ? "ranking_change"
      : /outrank|make.*beat/.test(text) ? "outrank"
      : /why not|second.best|second location/.test(text) ? "why_not_second"
      : /biggest risks|what.*risks/.test(text) ? "risks"
      : /trade.off/.test(text) ? "trade_off" : "why_here";
    value.audience = /community|residents/.test(text) ? "community"
      : /government|officials/.test(text) ? "government" : /developer/.test(text) ? "developer" : null;
    return validatedIntent(value);
  }

  const capacities = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(mw|megawatts?|gw|gigawatts?)\b/g)]
    .map((match) => Number(match[1]) * (/^g/.test(match[2]) ? 1000 : 1));
  if (new Set(capacities).size > 1 && !/instead|rather than|not.*but/.test(text)) value.clarification = "capacity";
  if (capacities.length) value.capacity_mw = capacities.at(-1)!;
  const contextualCapacity = getMissingRequiredFields(currentProject)[0] === "capacity" && !capacities.length
    ? text.trim().match(capacityAnswer) : null;
  if (contextualCapacity) value.capacity_mw = Number(contextualCapacity[1]);

  const training = /training/.test(text), inference = /inference/.test(text);
  value.workload_type = activeField === "workload_type" && nationwideAnswer.test(text.trim()) || /mixed|\bmix\b|both/.test(text) ? "MIXED"
    : training && inference ? null : training ? "AI_TRAINING" : inference ? "AI_INFERENCE" : /cloud/.test(text) ? "CLOUD" : null;
  if (training && inference && !/mixed|\bmix\b|both/.test(text)) value.clarification = "workload";

  const horizon = text.match(/(?:planning horizon|plan(?:ning)? through|horizon)\s*(?:of|to|is|year)?\s*(20\d{2}|2100)/);
  if (horizon) value.planning_horizon_year = Number(horizon[1]);
  const withoutHorizon = contextualCapacity ? "" : (horizon ? text.replace(horizon[0], "") : text)
    .replace(/\b\d+(?:\.\d+)?\s*(?:mw|megawatts?|gw|gigawatts?)\b/g, " ");
  const years = [...withoutHorizon.matchAll(/\b(20\d{2}|2100)\b/g)].map((match) => Number(match[1]));
  if (new Set(years).size > 1 && !/instead/.test(text)) value.clarification = "year";
  if (years.length) value.target_go_live_year = years.at(-1)!;

  let geographyText = text;
  const regions: string[] = [];
  const selectedStates: string[] = [];
  if (/washington\s+d\.?c\.?/.test(geographyText)) { selectedStates.push("DC"); geographyText = geographyText.replace(/washington\s+d\.?c\.?/, " "); }
  for (const [name, code] of Object.entries(stateAliases).sort((a, b) => b[0].length - a[0].length)) {
    const pattern = new RegExp("\\b" + name + "\\b");
    if (pattern.test(geographyText)) { selectedStates.push(code); geographyText = geographyText.replace(pattern, " "); }
    else if (new RegExp("\\b" + code + "\\b").test(message)) selectedStates.push(code);
  }
  for (const region of Object.keys(regionStates).sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp("\\b" + region + "\\b");
    if (pattern.test(geographyText)) { regions.push(region); geographyText = geographyText.replace(pattern, " "); }
  }
  if (regions.length || selectedStates.length || /united states|usa|u\.s\.|\bus\b/.test(text)) {
    value.geography = { country: "US", states: [...new Set(selectedStates)], regions };
  }
  if (nationwideAnswer.test(text.trim()) && activeField !== "workload_type") value.geography = { country: "US", states: [], regions: [] };
  if (/canada|europe|india|outside the us/.test(text)) value.clarification = "geography";

  const priorities: Array<[CategoryKey, RegExp]> = [
    ["energy", /clean energy|renewable|low.carbon|clean.*power|clean.*grid|energy.*priority/],
    ["water", /water.*(?:matter|more|important|priority|resilien|risk|stress)|low water/],
    ["climate", /climate|wildfire|drought|flood|heat risk/],
    ["infrastructure", /fiber|infrastructure|transmission|land availability|\bgrid\b/],
    ["economics", /cost|cheap|economic|tax/],
    ["approval", /approval|permit|zoning/],
    ["community", /community|social license|public concern/]
  ];
  for (const [factor, pattern] of priorities) {
    if (!pattern.test(text)) continue;
    if (factor === "infrastructure" && /clean\s+(?:energy|grid|power)/.test(text)) continue;
    if (factor === "climate" && /avoid|exclude|remove|drop|max|below|under/.test(text) && !/climate|prioriti[sz]e|matter|important/.test(text)) continue;
    const subject = factor === "economics" ? "cost|economics" : factor;
    const more = new RegExp("(?:" + subject + ").*(?:even more|much more|increase|higher priority)").test(text)
      || new RegExp("(?:increase|more weight).*?(?:" + subject + ")").test(text);
    const less = new RegExp("(?:" + subject + ").*(?:less important|secondary|lower priority|not important)").test(text)
      || new RegExp("(?:decrease|less weight).*?(?:" + subject + ")").test(text);
    if (more && less && !/instead/.test(text)) value.clarification = "priorities";
    const lessCost = factor === "economics" && /(?:energy|water).*(?:more than|more important than|matter more than|much more than|even more.*than).*cost/.test(text);
    value.priority_changes.push({ factor, importance: lessCost || less ? "LOW" : factor === "water" ? "VERY_HIGH" : "HIGH",
      direction: more && currentProject.activePrioritySignals.includes(factor) ? "increase" : less ? "decrease" : null });
  }
  // A comparative sentence explicitly lowers cost even when the adjective is
  // separated from "more than" by another priority.
  if (/matter.*more.*than cost|important.*than cost/.test(text)) {
    const cost = value.priority_changes.find((item) => item.factor === "economics");
    if (cost) { cost.importance = "LOW"; cost.direction = null; }
  }

  const patterns = [
    ["wildfire", /(?:wildfire|fire)(?:[- ]risk)?[^.;]*?(?:below|under|less than|max(?:imum)?(?: of)?|at most|<=)\s*(\d+(?:\.\d+)?)/, 60],
    ["drought", /drought(?:[- ]risk)?[^.;]*?(?:below|under|less than|max(?:imum)?(?: of)?|at most|<=)\s*(\d+(?:\.\d+)?)/, 60],
    ["water", /water(?:[- ]resilience)?[^.;]*?(?:above|over|minimum(?: of)?|at least|>=)\s*(\d+(?:\.\d+)?)/, null],
    ["grid", /grid(?:[- ]readiness)?[^.;]*?(?:above|over|minimum(?: of)?|at least|>=)\s*(\d+(?:\.\d+)?)/, null],
    ["fiber", /fiber[^.;]*?(?:above|over|minimum(?: of)?|at least|>=)\s*(\d+(?:\.\d+)?)/, null],
    ["carbon", /carbon[^.;]*?(?:below|under|maximum(?: of)?|at most|<=)\s*(\d+(?:\.\d+)?)/, null]
  ] as const;
  for (const [factor, pattern, defaultMaximum] of patterns) {
    const definition = constraintDefinitions[factor];
    const removal = new RegExp("(?:remove|drop).*" + factor).test(text);
    if (removal) { value.constraints_to_remove.push(definition.id); continue; }
    const match = text.match(pattern) ?? text.match(new RegExp("(?:max(?:imum)?|min(?:imum)?)\\s+" + factor + "(?:[- ]risk|[- ]resilience|[- ]readiness| coverage)?(?: proxy)?\\s*(?:of|is|:|=)?\\s*(\\d+(?:\\.\\d+)?)"));
    const avoid = defaultMaximum !== null && new RegExp("(?:avoid|exclude|do not show).*" + factor).test(text);
    const threshold = match ? Number(match[1]) : defaultMaximum;
    if ((match || avoid) && threshold !== null) value.constraints_to_add.push({ factor,
      operator: ["water", "grid", "fiber"].includes(factor) ? ">=" : "<=", value: threshold });
  }
  return validatedIntent(value);
}
