# Scoring Clarity Report

Date: 2026-10-04. Scope: tutorial, factor metadata and frontend presentation only.

## Delivered

| Area | Implementation |
| --- | --- |
| Central registry | Seven stable backend category IDs with display names, descriptions, priority/score meanings, zero/100 interpretations, underlying metrics, source summaries, proxy caveats and availability. |
| Tutorial | Four concise steps: recommendations, independent user priorities, location scores, hard constraints. First visit only; local dismissal; persistent help icon; Skip, Back, Next, Done and Escape. |
| Renamed labels | Infrastructure & Connectivity replaces Infrastructure & Land; Workforce & Community Context replaces Community Readiness and Workforce Context in frontend factor labels. Backend records remain unchanged. |
| Approval | Data unavailable in location performance and comparison, never a manufactured zero. Help identifies unverified zoning, permitting, utility and project-specific approvals. |
| Priority versus score | Your Priorities uses editable 0-100 importance inputs. Location Performance uses static processed scores formatted /100, with no sliders. Hard Constraints is a separate fieldset. Neither scale represents probability. |
| Shared help | Registry-driven factor definitions in the editor, compact profile, strengths, location performance and detailed metric evidence. Capacity is a requirement; go-live year is context, not a forecast. |
| Accessibility | Native modal dialogs with explicit forward/backward focus loops. Escape closes only the current nested dialog; focus returns to its trigger. No horizontal overflow in verified desktop viewports. |
| Preserved foundation | Ranking, normalization, feasibility, stores, API implementations, map logic, canonical workspace state and LLM provider implementation/selection are unchanged. |

## Priority Presentation

Projects still store their existing normalized weights. The editor maintains a
separate draft of independent 0-100 inputs and converts that draft through the
existing `normalizeWeights` function only when priorities are edited and applied.
Changing one slider does not move another slider. Ignore means a zero weight.
All-Ignore inputs are blocked rather than silently restoring default weights.
Opening and applying untouched criteria preserves exact weights, including their
stored rounding. Cancelling a draft or rejecting a revision-conflicted update
does not save the draft's input scale.

The browser retains the most recent successful input scale locally. It is reused
only when both its saved weights and its normalized input ratios agree with the
current canonical weights. Otherwise the UI reconstructs an equivalent relative
scale with the highest at 100. This adds no backend fields or persistence contract.
Missing factor scores continue to be excluded and available weights renormalized
by the unchanged engine. A priority for unavailable approval evidence is not an
approval score and contributes nothing while approval is unavailable.

The tutorial's threshold example uses the actual supported constraint
`water-resilience-min`: `category_scores.water >= 70`. Below 70 is excluded; missing
required evidence is insufficient data and excluded. It deliberately does not
describe a fabricated wildfire-resilience threshold: the existing wildfire
constraint uses the raw risk index. This is verified against actual feasibility
behavior without changing that behavior.

## Metadata Consumers

The registry covers EPA eGRID/NOAA energy screening, WRI Aqueduct water stress,
FEMA climate hazards, FCC county mass-market fiber, EIA industrial electricity
prices, ACS labor-pool context and unavailable local approvals. Metrics match
`config/features.yaml`; context-only socioeconomic evidence is not presented as
an additional scoring input. County/source availability does not guarantee an
individual county has a usable score.

Shared frontend summary labels also feed the existing grounded summary fact
builder, so concise LLM explanation context receives the same factor names. No
provider, transport, model selection, prompt, API or caching architecture was
modified. Original evidence JSON and full transformations/hashes remain in the
existing detailed Evidence/Methodology flow.

## Files Changed

New files:

- `apps/web/lib/frontend/factor-metadata.ts`
- `apps/web/lib/frontend/priorities.ts`
- `apps/web/components/scoring/FactorHelp.tsx`
- `apps/web/components/scoring/ScoringTutorial.tsx`
- `apps/web/components/scoring/LocationPerformance.tsx`
- `apps/web/components/scoring/scoring.test.tsx`
- `apps/web/test/browser-storage.ts`
- `docs/SCORING_CLARITY_REPORT.md`

Updated files:

- `apps/web/components/filters/CriteriaEditor.tsx`
- `apps/web/components/filters/TopProfileBar.tsx`
- `apps/web/components/projects/ProjectToolbar.tsx`
- `apps/web/components/workspace/Dialog.tsx`
- `apps/web/components/chat/ChatPanel.tsx` (factor change labels only)
- `apps/web/lib/frontend/location-summary.ts`
- `apps/web/components/location/LocationSummary.tsx`
- `apps/web/components/location/LocationDetail.tsx`
- `apps/web/components/location/MetricDetails.tsx`
- `apps/web/components/location/ExplanationTree.tsx`
- `apps/web/components/compare/ComparePanel.tsx`
- `apps/web/components/changes/RankingDiffPanel.tsx`
- `apps/web/app/page.tsx`
- `apps/web/app/page.test.tsx`
- `apps/web/app/workspace.test.tsx`
- `apps/web/components/location/location-summary.test.tsx`
- `apps/web/components/location/decision-ui.test.tsx`
- `README.md`

## Verification

- Full suite: `make test`, 41 pipeline tests and 258 application tests (299 total).
- New scoring/tutorial coverage: 21 tests, including each factor's identical help
  across priority, performance and evidence views; missing approval; real zero
  workforce scores; honest power/connectivity claims; capacity and year context;
  independent inputs; exact untouched Apply; rejected/corrupt local scales;
  persistence/reopening; focus loops and nested Escape isolation.
- TypeScript: `npm run lint` passed.
- Production: `npm run build` passed.
- Chrome/Playwright: 1024x900, 1440x900 and 1920x900 passed with no console errors,
  no horizontal/text overflow, nonblank maps, keyboard focus trapping/return,
  first-visit persistence, reopening, independent priority editing and exact
  untouched Apply. All seven performance rows match real processed scores; all
  23 evidence records for the selected county match original backend JSON.
- Existing concise explanations remain 63 developer, 63 government and 68
  community words in these checks. No live-provider calls were needed for this
  presentation-only pass; browser verification used the deterministic fallback.
- SHA-256 protection check: all 69 captured API/engine/data/pipeline/map/project/
  LLM/workspace implementation files remain byte-identical.

Logs: `/tmp/scoring-help-{complete-tests,typescript,production-build,desktop-browser}.log`.
Screenshots: `/tmp/scoring-help-{1024,1440,1920}-{first-visit,priority-tutorial,score-tutorial,constraints-tutorial,criteria,criteria-top,performance,workforce-help}.png`.
Browser acceptance script: `/tmp/datacenter-map-browser-20261003/scoring-help-smoke.mjs`.

Browser persistence depends on localStorage being allowed. When storage is denied,
the current tutorial can still be dismissed and reopened, but a later browser
visit cannot reliably remember dismissal. No login, future scenarios, land
suitability, verified capacity, resident-support findings or approval evidence
were added.
