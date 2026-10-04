"use client";

import { ChevronRight, Database, MapPin } from "lucide-react";
import type { DecisionTrace, ExplanationNode, ProjectState } from "@/lib/types/domain";
import { displayValue, MetricDetails } from "./MetricDetails";
import { factorLabels } from "@/lib/frontend/factor-metadata";
import { categoryKeys, type CategoryKey } from "@/lib/types/domain";

export function ExplanationTree({ trace, project, onSelect }: { trace: DecisionTrace; project: ProjectState; onSelect: (id: string) => void }) {
  return <ul className="explanation-tree" aria-label="Deterministic explanation graph"><TreeNode node={trace.explanation_graph.root} trace={trace} project={project} onSelect={onSelect} depth={0} /></ul>;
}

function TreeNode({ node, trace, project, onSelect, depth }: { node: ExplanationNode; trace: DecisionTrace; project: ProjectState; onSelect: (id: string) => void; depth: number }) {
  const qualities = trace.metrics.filter((metric) => node.source_refs?.includes(metric.evidence_id));
  const driver = [...trace.positive_drivers, ...trace.negative_drivers].find((item) => node.id === `positive:${item.factor}` || node.id === `negative:${item.factor}`);
  const alternativeId = node.kind === "comparison" && /^county-\d{5}$/.test(node.label) ? node.label : undefined;
  const comparisonFactor = node.kind === "comparison" ? node.id.split(":").at(-1) as CategoryKey : undefined;
  const label = driver ? factorLabels[driver.factor] : comparisonFactor && categoryKeys.includes(comparisonFactor) ? factorLabels[comparisonFactor] : node.label;
  return <li data-node-id={node.id} data-node-kind={node.kind}>
    <details open={depth < 2}>
      <summary><ChevronRight size={14} className="tree-chevron" /><span className="min-w-0 flex-1 break-words">{label}</span>
        {node.score != null ? <span className="tree-score">{node.score.toFixed(2)} / 100</span> : null}
      </summary>
      <div className="tree-body">
        {node.value !== undefined ? <p className="text-xs text-steel">Value: <strong className="text-ink">{displayValue(node.value)}</strong></p> : null}
        {node.contribution !== undefined ? <p className="text-xs text-steel">Weighted contribution: <strong className="text-ink">{node.contribution} points</strong></p> : null}
        {driver ? <p className="text-xs text-steel">Normalized project weight {project.weights[driver.factor].toFixed(4)} / effective weight {driver.weight.toFixed(4)}</p> : null}
        {node.description ? <p className="text-xs leading-5 text-steel">{node.description}</p> : null}
        {alternativeId ? <button className="text-command" onClick={() => onSelect(alternativeId)}><MapPin size={14} />Select alternative</button> : null}
        {qualities.map((metric) => <details key={metric.evidence_id} className="node-evidence"><summary><Database size={13} />{metric.source || "Missing evidence"} / {metric.metric_type}</summary>
          <MetricDetails metric={metric} evidence={trace.evidence.find((item) => item.evidence_id === metric.evidence_id)} />
        </details>)}
        {node.children?.length ? <ul>{node.children.map((child) => <TreeNode key={child.id} node={child} trace={trace} project={project} onSelect={onSelect} depth={depth + 1} />)}</ul> : null}
        {!node.children?.length && !node.description && node.value === undefined && !qualities.length ? <p className="text-xs text-steel">No additional evidence in this trace.</p> : null}
      </div>
    </details>
  </li>;
}
