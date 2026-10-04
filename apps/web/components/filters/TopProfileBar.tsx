"use client";

import { SlidersHorizontal } from "lucide-react";
import { factorLabels, capacityHelp, goLiveHelp } from "@/lib/frontend/factor-metadata";
import { readPriorities } from "@/lib/frontend/priorities";
import { FactorHelp, InfoDialog } from "@/components/scoring/FactorHelp";
import type { CategoryKey, ProjectState } from "@/lib/types/domain";
import { geographyLabel } from "./StateSelector";
import { workloadLabel } from "./CriteriaEditor";

export function TopProfileBar({ project, disabled, onEdit }: { project: ProjectState; disabled?: boolean; onEdit: () => void }) {
  const priorities = Object.entries(project.weights).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const inputs = readPriorities(project.weights);
  return <section className="project-summary" aria-label="Project summary">
    <div><div className="summary-profile"><strong className="profile-help">{project.capacityMw} MW<InfoDialog title="Capacity">{capacityHelp}</InfoDialog></strong><span>{workloadLabel(project.workloadType)}</span><span className="profile-help">{project.targetGoLiveYear}<InfoDialog title="Go-live year">{goLiveHelp}</InfoDialog></span><span>United States</span><span>{geographyLabel(project.geography)}</span></div>
      <div className="summary-priorities" aria-label="Your priorities">{priorities.map(([factor]) => <span className="profile-help" key={factor}>{factorLabels[factor as CategoryKey]} <strong>Priority: {Math.round(inputs[factor as CategoryKey])}/100</strong><FactorHelp factor={factor as CategoryKey} /></span>)}
        {project.constraints.length ? <span className="text-saffron">{project.constraints.length} hard constraint{project.constraints.length === 1 ? "" : "s"}</span> : null}
      </div>
    </div><button className="secondary-command" disabled={disabled} onClick={onEdit}><SlidersHorizontal size={15} />Edit Criteria</button>
  </section>;
}
