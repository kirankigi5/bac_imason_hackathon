"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { cloneProject } from "@/lib/project/defaults";
import { factorMetadata, capacityHelp, goLiveHelp } from "@/lib/frontend/factor-metadata";
import { priorityImportance, readPriorities, rememberPriorities, weightsFromPriorities } from "@/lib/frontend/priorities";
import { FactorHelp, InfoDialog } from "@/components/scoring/FactorHelp";
import { constraintDefinitions } from "@/lib/llm/schemas";
import { categoryKeys, type ProjectState, type WorkloadType } from "@/lib/types/domain";
import { StateSelector } from "./StateSelector";

export const workloadLabel = (workload?: WorkloadType) => ({ AI_TRAINING: "AI Training", AI_INFERENCE: "AI Inference", MIXED: "Mixed", CLOUD: "General Cloud" })[workload ?? "AI_TRAINING"];

export function CriteriaEditor({ project, pending, onApply }: { project: ProjectState; pending: boolean; onApply: (project: ProjectState) => void | Promise<boolean | void> }) {
  const [draft, setDraft] = useState(() => cloneProject(project));
  const [priorities, setPriorities] = useState(() => readPriorities(project.weights));
  const [prioritiesChanged, setPrioritiesChanged] = useState(false);
  const [constraintKey, setConstraintKey] = useState<keyof typeof constraintDefinitions>("wildfire");
  const [limit, setLimit] = useState("");
  const [operator, setOperator] = useState<"<=" | ">=">("<=");
  const definition = constraintDefinitions[constraintKey];
  const hasPriority = Object.values(priorities).some((value) => value > 0);
  return <form className="criteria-form" onSubmit={async (event) => {
    event.preventDefault();
    if (!hasPriority) return;
    const next = { ...draft, weights: prioritiesChanged ? weightsFromPriorities(priorities) : draft.weights };
    if (await onApply(next) !== false) rememberPriorities(next.weights, priorities);
  }}>
    <fieldset disabled={pending}><legend>Project</legend><div className="criteria-fields">
      <div className="project-field"><div><label htmlFor="criteria-capacity">Capacity MW</label><InfoDialog title="Capacity">{capacityHelp}</InfoDialog></div><input id="criteria-capacity" className="field" aria-label="Capacity MW" type="number" min="1" max="100000" required value={draft.capacityMw ?? ""} onChange={(event) => setDraft({ ...draft, capacityMw: Number(event.target.value) || undefined })} /></div>
      <div className="project-field"><div><label htmlFor="criteria-year">Go-live year</label><InfoDialog title="Go-live year">{goLiveHelp}</InfoDialog></div><input id="criteria-year" className="field" aria-label="Go-live year" type="number" min="2026" max="2100" required value={draft.targetGoLiveYear ?? ""} onChange={(event) => setDraft({ ...draft, targetGoLiveYear: Number(event.target.value) || undefined })} /></div>
      <label className="col-span-2">Workload<select className="field" aria-label="Workload" required value={draft.workloadType ?? ""} onChange={(event) => setDraft({ ...draft, workloadType: event.target.value as WorkloadType })}>
        <option value="">Choose workload</option>{(["AI_TRAINING", "AI_INFERENCE", "MIXED", "CLOUD"] as const).map((workload) => <option key={workload} value={workload}>{workloadLabel(workload)}</option>)}
      </select></label>
    </div></fieldset>
    <fieldset disabled={pending}><legend>Your Priorities</legend><div className="editor-priorities">{categoryKeys.map((factor) => <div key={factor} className="priority-control">
      <div className="priority-heading"><label htmlFor={`priority-${factor}`}>{factorMetadata[factor].display_name}</label><FactorHelp factor={factor} /></div>
      <div className="priority-value"><span>{priorityImportance(priorities[factor])}</span><output htmlFor={`priority-${factor}`}>Priority: {Math.round(priorities[factor])}/100</output></div>
      <input id={`priority-${factor}`} type="range" aria-label={`${factorMetadata[factor].display_name} priority`} aria-valuetext={`${Math.round(priorities[factor])} of 100, ${priorityImportance(priorities[factor])}`} min="0" max="100" step="1" value={Math.round(priorities[factor])} onChange={(event) => {
        setPriorities({ ...priorities, [factor]: Number(event.target.value) }); setPrioritiesChanged(true);
        setDraft({ ...draft, activePrioritySignals: [...new Set([...draft.activePrioritySignals, factor])] });
      }} />
      {!factorMetadata[factor].available ? <small>Data unavailable; excluded from scoring until verified.</small> : null}
    </div>)}</div>{!hasPriority ? <p role="alert" className="text-rosewood text-xs mt-3">At least one priority must be above Ignore.</p> : null}</fieldset>
    <fieldset disabled={pending} className="hard-constraints"><legend>Hard Constraints</legend>
      <ul className="constraint-list">{draft.constraints.map((constraint) => <li key={constraint.id}><span>{constraint.label}</span>
        <button type="button" className="icon-button" aria-label={`Remove ${constraint.label}`} title="Remove requirement" onClick={() => setDraft({ ...draft, constraints: draft.constraints.filter((row) => row.id !== constraint.id) })}><X size={14} /></button></li>)}</ul>
      <div className="constraint-editor"><select className="field" aria-label="Requirement metric" value={constraintKey} onChange={(event) => { setConstraintKey(event.target.value as typeof constraintKey); setLimit(""); }}>
        {Object.entries(constraintDefinitions).map(([key, row]) => <option value={key} key={key}>{row.label}</option>)}</select>
        <select className="field" aria-label="Requirement operator" value={operator} onChange={(event) => setOperator(event.target.value as typeof operator)}><option value="<=">At most</option><option value=">=">At least</option></select>
        <input className="field" aria-label="Requirement threshold" type="number" min="0" max={definition.max} step="any" placeholder="Limit" value={limit} onChange={(event) => setLimit(event.target.value)} />
        <button type="button" className="icon-button" title="Add requirement" aria-label="Add requirement" disabled={limit === "" || !Number.isFinite(Number(limit)) || Number(limit) < 0 || Number(limit) > definition.max} onClick={() => {
          setDraft({ ...draft, constraints: [...draft.constraints.filter((row) => row.id !== definition.id), { id: definition.id, metric: definition.metric,
            label: `${definition.label} ${operator} ${limit}`, operator, value: Number(limit), kind: "hard" }] }); setLimit("");
        }}><Plus size={16} /></button>
      </div>
    </fieldset>
    <fieldset disabled={pending}><StateSelector geography={draft.geography} onChange={(geography) => setDraft({ ...draft, geography })} /></fieldset>
    <div className="dialog-actions"><button className="primary-command" disabled={pending || !hasPriority || !draft.activePrioritySignals.length && !draft.constraints.length} type="submit">{pending ? "Updating..." : "Apply Criteria"}</button></div>
  </form>;
}
