"use client";

import { Compass, FolderOpen, ChevronDown, Save } from "lucide-react";
import { ScoringHelp } from "@/components/scoring/ScoringTutorial";

export function ProjectToolbar({ name, ready, pending, savedView, onPlanner, onSaved, onProject, onSave }: {
  name: string; ready: boolean; pending: boolean; savedView: boolean;
  onPlanner: () => void; onSaved: () => void; onProject: () => void; onSave: () => void;
}) {
  return <header className="planner-navigation">
    <a href="/" className="planner-brand" onClick={(event) => { event.preventDefault(); onPlanner(); }}><Compass size={25} /><span>Sustainable AI<br /><strong>Infrastructure Planner</strong></span></a>
    <nav aria-label="Main navigation"><button aria-current={!savedView ? "page" : undefined} onClick={onPlanner}>Planner</button>
      <button aria-current={savedView ? "page" : undefined} onClick={onSaved}><FolderOpen size={15} />Saved Projects</button></nav>
    <div className="project-navigation">{ready ? <span className="current-project-name">{name}</span> : null}
      <ScoringHelp />
      {ready ? <button className="icon-button" aria-label="Save current project" title="Save project" disabled={pending} onClick={onSave}><Save size={16} /></button> : null}
      <button className="text-command project-menu" disabled={pending} onClick={onProject}>Project<ChevronDown size={14} /></button>
    </div>
  </header>;
}
