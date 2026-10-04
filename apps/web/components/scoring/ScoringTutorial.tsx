"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CircleHelp, Check } from "lucide-react";
import { Dialog } from "@/components/workspace/Dialog";
import { factorMetadata } from "@/lib/frontend/factor-metadata";

export const tutorialStorageKey = "scoring-tutorial-dismissed-v1";
const stepTitles = ["How recommendations work", "Your priority: 0-100", "Location score: 0-100", "Hard constraints"];

export function ScoringHelp() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    try { if (window.localStorage.getItem(tutorialStorageKey) !== "true") setOpen(true); }
    catch { setOpen(true); }
  }, []);
  const dismiss = () => {
    try { window.localStorage.setItem(tutorialStorageKey, "true"); } catch { /* Keep help usable when browser storage is disabled. */ }
    setOpen(false);
  };
  return <><button type="button" ref={trigger} className="icon-button" aria-label="How scoring works" title="How scoring works" onClick={() => setOpen(true)}><CircleHelp size={18} /></button>
    {open ? <Dialog title="How Scoring Works" onClose={dismiss} returnFocusRef={trigger}><ScoringTutorial onDismiss={dismiss} /></Dialog> : null}</>;
}
function ScoringTutorial({ onDismiss }: { onDismiss: () => void }) {
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  return <div className="scoring-tutorial">
    <p className="tutorial-progress" aria-live="polite">Step {step + 1} of 4</p>
    <h3 ref={heading} tabIndex={-1}>{stepTitles[step]}</h3>
    <div className="tutorial-step">
      {step === 0 ? <><p>Describe what you want to build. We translate your requirements into transparent priorities and constraints, then evaluate real U.S. county-level data.</p>
        <dl className="tutorial-concepts"><div><dt>User priority</dt><dd>How much do I care about this factor?</dd></div>
          <div><dt>Location score</dt><dd>How favorable is this county's screening indicator?</dd></div>
          <div><dt>Hard constraint</dt><dd>Does this county pass a required threshold?</dd></div></dl></> : null}
      {step === 1 ? <><dl className="tutorial-scale">{[[0, "Ignore"], [25, "Low"], [50, "Medium"], [75, "High"], [100, "Highest"]].map(([value, label]) =>
        <div key={value}><dt>{value}</dt><dd>{label}</dd></div>)}</dl>
        <h4>Example priorities</h4><dl className="tutorial-examples"><div><dt>{factorMetadata.water.display_name}</dt><dd>90/100</dd></div>
          <div><dt>{factorMetadata.energy.display_name}</dt><dd>80/100</dd></div><div><dt>{factorMetadata.economics.display_name}</dt><dd>30/100</dd></div></dl>
        <p>Water matters much more than cost. Active priorities are normalized into relative weights; these values are not percentages. Factors with missing scores are excluded and available weights are renormalized.</p></> : null}
      {step === 2 ? <><p>100 means more favorable according to the underlying data and normalization; 50 is moderate; 0 is less favorable. Neither priorities nor location scores are probabilities.</p>
        <h4>Example location scores</h4><dl className="tutorial-examples"><div><dt>{factorMetadata.water.display_name}</dt><dd>92/100</dd></div>
          <div><dt>{factorMetadata.energy.display_name}</dt><dd>81/100</dd></div><div><dt>{factorMetadata.climate.display_name}</dt><dd>73/100</dd></div></dl>
        <p>This does not mean 92% water availability or an 81% chance of success.</p><p className="tutorial-caveat">{factorMetadata.energy.proxy_caveat}</p></> : null}
      {step === 3 ? <><p>Priorities influence ranking. Hard constraints can eliminate a location.</p><dl className="tutorial-concepts">
        <div><dt>{factorMetadata.water.display_name} priority: 90/100</dt><dd>Strongly influences ranking.</dd></div>
        <div><dt>{factorMetadata.water.display_name} score: at least 70/100</dt><dd>Counties below 70 are excluded. Missing required evidence also excludes a county; missing is not zero.</dd></div></dl>
        <p>Wildfire constraints use a maximum raw-risk index, not a minimum resilience score.</p></> : null}
    </div>
    <footer className="tutorial-actions"><button type="button" className="text-command" onClick={onDismiss}>Skip</button>
      <div>{step > 0 ? <button type="button" className="secondary-command" onClick={() => setStep(step - 1)}><ArrowLeft size={15} />Back</button> : null}
        <button type="button" className="primary-command" onClick={() => step === 3 ? onDismiss() : setStep(step + 1)}>{step === 3 ? <Check size={15} /> : <ArrowRight size={15} />}{step === 3 ? "Done" : "Next"}</button></div></footer>
  </div>;
}
