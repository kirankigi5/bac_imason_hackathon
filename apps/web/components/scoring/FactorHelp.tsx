"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { Dialog } from "@/components/workspace/Dialog";
import { factorMetadata } from "@/lib/frontend/factor-metadata";
import type { CategoryKey } from "@/lib/types/domain";

export function InfoDialog({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="factor-info icon-button" title={`About ${title}`} aria-label={`About ${title}`} onClick={() => setOpen(true)}><Info size={14} /></button>
    {open ? <Dialog title={title} onClose={() => setOpen(false)}>{children}</Dialog> : null}</>;
}
export function FactorHelp({ factor }: { factor: CategoryKey }) {
  const metadata = factorMetadata[factor];
  return <InfoDialog title={metadata.display_name}><dl className="factor-definitions" data-factor-help={factor}>
    <div><dt>User priority</dt><dd>{metadata.priority_meaning}</dd></div>
    <div><dt>Location score</dt><dd>{metadata.score_meaning}</dd></div>
    <div><dt>Score 0</dt><dd>{metadata.score_zero_meaning}</dd></div>
    <div><dt>Score 100</dt><dd>{metadata.score_hundred_meaning}</dd></div>
    <div><dt>Sources</dt><dd>{metadata.source_summary}</dd></div>
    <div><dt>Screening limitation</dt><dd>{metadata.proxy_caveat}</dd></div>
  </dl></InfoDialog>;
}
