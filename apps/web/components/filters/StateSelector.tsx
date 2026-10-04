"use client";

import { useState } from "react";
import { stateAliases, regionStates } from "@/lib/project/geography";
import type { Geography } from "@/lib/types/domain";

const supported = Object.entries(stateAliases).filter(([, code]) => code !== "AK" && code !== "HI");
export const geographyLabel = (geography?: Geography) => geography?.states?.length ? geography.states.join(", ")
  : geography?.regions?.length ? geography.regions.join(", ") : "Anywhere in U.S.";

export function StateSelector({ geography, onChange }: { geography?: Geography; onChange: (value: Geography) => void }) {
  const [showStates, setShowStates] = useState(!!(geography?.states?.length || geography?.regions?.length));
  const [query, setQuery] = useState("");
  const selected = geography?.states ?? geography?.regions?.flatMap((region) => regionStates[region] ?? []) ?? [];
  return <fieldset className="state-selector"><legend>United States</legend>
    <div className="scope-options">
      <label><input type="radio" name="state-scope" checked={!showStates} onChange={() => { setShowStates(false); onChange({ country: "US", states: [] }); }} />Anywhere in U.S.</label>
      <label><input type="radio" name="state-scope" checked={showStates} onChange={() => setShowStates(true)} />Selected states</label>
    </div>
    {showStates ? <><input type="search" className="field" aria-label="Find state" placeholder="Find a state" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="state-options">{supported.filter(([name, code]) => `${name} ${code}`.toLowerCase().includes(query.toLowerCase())).map(([name, code]) => <label key={code}>
        <input type="checkbox" checked={selected.includes(code)} aria-label={name.replace(/\b\w/g, (letter) => letter.toUpperCase())} onChange={(event) => {
          const states = event.target.checked ? [...new Set([...selected, code])].sort() : selected.filter((state) => state !== code);
          onChange({ country: "US", states });
        }} /><span className="capitalize">{name}</span><small>{code}</small>
      </label>)}</div><p className="scope-note">{selected.length ? `${selected.length} selected` : "All supported U.S. counties"}</p></> : null}
  </fieldset>;
}
