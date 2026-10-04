# Frontend Integration Report

Verified October 3, 2026 (America/New_York). This report covers the frontend phase
following the verified decision-platform backend. CODEX.md is not fully implemented.

Historical report: the October 4 desktop chat-first redesign supersedes the
permanent-tab layout and verification totals below. See
[UX Redesign Report](UX_REDESIGN_REPORT.md) for the current interface and checks.

## Completion Table

| Requested Area | Implemented And Verified | Limits |
| --- | --- | --- |
| Frontend files | Workspace/controller, request resources, tree, quality, comparison, diff, projects/history and responsive composition | No new production dependency, dataset, model or scoring implementation |
| Explanation graph | Recursive native expandable tree from `decision-trace.explanation_graph`; exact node IDs and source references | Deterministic graph, not an LLM-generated tree or trained model |
| Selected location | Actual county, rank, screening score, four-state feasibility, drivers, weaknesses, missing evidence, source evidence and Why Here? | A selected county remains inspectable outside the visible top 20 |
| Ranking diff | Backend fields/priorities, before/after rank and score, exact contributions, four constraint-transition groups and top-20 movements | Same-release rerun, not historical-release replay |
| Synchronization | One canonical profile for accepted chat/filter changes, map, trace and comparison; request scoping rejects late responses | Writes are serialized; revision conflicts require explicit reload |
| Saved projects | Create, save, picker/reopen, URL reload, profile/selection/comparison preservation, revision/date and snapshot freshness | Local single-user storage without authentication |
| Project history | Accepted audit events, source/message, exact changed fields, old/new values, winner/count effects and evaluation versions | Local integrity check is not externally signed or tamper-proof |
| Feasibility/quality | All four exact statuses; measured/proxy/estimated/missing labels, raw/normalized values, confidence, provenance and caveats | No unsupported MW, dedicated fiber, tariff, parcel approval or community-support finding |
| Audience modes | Developer/Government/Community alter explanation selection/language only | Trace, scores, ranking, evidence and feasibility remain unchanged |
| Verification | 41 Python + 144 app tests; TypeScript; production build; production HTTP; desktop/mobile development and production browsers; live Gemini desktop | Live providers can still return invalid/unavailable responses; deterministic fallback remains necessary |
| Remaining CODEX.md | Core real-data conversational screening and explainability are integrated | Scenario/construction, additional site evidence and advanced optimization remain unimplemented |

## Files

New frontend/controller files:

- `apps/web/lib/frontend/api.ts`
- `apps/web/lib/frontend/contracts.ts` (type-only backend contracts)
- `apps/web/lib/frontend/use-api-resource.ts`
- `apps/web/lib/frontend/use-workspace.ts`
- `apps/web/components/location/ExplanationTree.tsx`
- `apps/web/components/location/FeasibilityStatus.tsx`
- `apps/web/components/location/MetricDetails.tsx`
- `apps/web/components/changes/RankingDiffPanel.tsx`
- `apps/web/components/projects/ProjectToolbar.tsx`
- `apps/web/components/projects/DecisionHistory.tsx`

Existing frontend files updated:

- `apps/web/app/page.tsx`
- `apps/web/app/globals.css`
- `apps/web/components/location/LocationDetail.tsx`
- `apps/web/components/compare/ComparePanel.tsx`
- `apps/web/components/filters/TopProfileBar.tsx`
- `apps/web/components/map/DecisionMap.tsx`
- `apps/web/components/chat/ChatPanel.tsx`

Tests added in `app/workspace.test.tsx`,
`components/location/decision-ui.test.tsx` and
`lib/frontend/use-api-resource.test.tsx`. The existing `app/page.test.tsx` fetch
mock was extended for project-list and diff requests; its assertions were retained.
README links this report and replaces the previous pending-frontend statements.

## Implementation Details

Graph sections and leaves are backend nodes. Expansion exposes each node's actual
value, score, contribution, description and referenced metric evidence. Driver
nodes distinguish user priority from the backend's effective, missing-data-adjusted
weight. Evidence shows dates, units, transformations, artifact names and SHA-256
where supplied. Official source links use backend provenance URLs.

The selected-county header remains available across tabs. Why Here? is an explicit
request for grounded prose; changing the profile/selection invalidates old prose.
Audience changes do not request a ranking change. A selected county outside the
top 20 is loaded by ID and plotted using its backend feature/trace, not assigned
a frontend score. Excluded selected counties retain their exact status.

Comparisons accept two to four counties and expose selectable pairs. Their
directional score/factor deltas, rounding adjustment and winner are consumed
verbatim. Missing scores stay Missing; an unavailable category's backend
contribution of zero is not displayed as a measured score of zero.

Reopened profiles always use a fresh current-release search. STALE metadata
describes the stored snapshot, not the newly evaluated map. The stored historical
snapshot is unchanged until save/update. Save/open/update failures are visible;
409 conflicts are not retried by overwriting a newer revision.

## Verification

| Check | Result |
| --- | --- |
| `make test` | 41 Python + 144 application tests passed (185 total, 18 new frontend tests) |
| `npm run lint` | TypeScript passed |
| `npm run build` | Optimized Next.js production build passed |
| Production `verify:backend` | Project create/read/update/history, traces, comparisons, exact diffs, versions and conflicts passed |
| Production no-key `verify:llm` | Intent, location explanation and ranking-change explanation all passed fallback; no live credentials used |
| Development browsers | 1440x1000 and 390x844 acceptance workflows passed |
| Production browsers | 1440x1000 and 390x844 acceptance workflows passed |
| Live Gemini production desktop | Intake, Why Here?, water update, winner-change explanation and Community explanation all passed in LLM mode |
| Missing FCC browser case | Both viewports preserved null fiber raw/normalized values and rendered INSUFFICIENT_DATA for a required fiber minimum |
| Selection outside top 20 | Saved Kent County reopened at actual rank 267, score 72.9; map showed its selected marker alongside the 20 ranked counties |
| Map rendering | Nonblank canvas pixel variance and changed canvas after zoom; correct real ranked markers |
| Layout | Screenshots inspected for map/tree/diff/comparison/history; no document horizontal overflow |
| Browser errors | No page, console or worker errors in the successful runs |
| Client credential scan | 20 production client assets scanned against three configured secret values; zero occurrences |

Frontend tests call actual route handlers with the real published feature store
and temporary SQLite databases. They prove graph-node/evidence identity, exact
pairwise deltas, canonical chat/filter updates, selected trace loading, feasibility,
missing evidence, save/reopen, accepted history, audience invariance, conflict
handling, stale-snapshot separation and rejection of late asynchronous responses.
The stale-snapshot test modifies only an ephemeral test database. No production
feature/evidence artifact is altered.

Browser checks used Playwright with locally installed Chrome. No-key production
ran on port 3010, live Gemini production on 3011, and isolated development on
3000. All verification projects used temporary database paths, not the user's
project database. Browser harnesses are in
`/tmp/datacenter-map-browser-20261003/`; screenshots use
`/tmp/frontend-{production,development,gemini}-<width>-<view>.png`.
Gemini used the existing server-side configuration; keys were not printed.
Per-operation health resets to unverified when the server restarts.

## Real Data Unchanged

The release remains `ec0ed269269ed0f45e5b`: 3,109 counties, 71,471 evidence rows,
90.5% configured-metric completeness. Scoring remains `county-screening-v2.0.0`.
Actual SHA-256 checks matched the foundation:

```text
features: b49daf3a5a597865c8784d637995310223540810108d9b180f98a737f9b9b836
evidence: bca5bd0729f43bac0e22e879f6fbde2594837adf09bca25151210dea385dfc2c
FCC CSV:  926bc4e1a4235770089f8fd64f58aff5e81b99b7e97cc3ae8aa32f90bfd2199c
```

The original FCC ZIP remains absent. Unchanged CSV provenance is recorded
explicitly. Nine current Connecticut planning regions still lack compatible FCC
coverage; no legacy-county allocation or fabricated fiber is introduced.

## Remaining Work

- Actual site capacity/interconnection, dedicated fiber/routes, utility tariffs,
  parcels, land/materials, heat reuse and documented local approval are not verified.
- ACS workforce context is not community acceptance. No scraping or approval
  prediction was added.
- Future scenarios, construction scoring, Pareto/sensitivity optimization and
  parcel-level evaluation remain outside this phase.
- No custom model was trained. Ollama/local-model transport is not implemented;
  `local` currently means deterministic fallback.
- Authentication/multi-user deployment is not implemented. Keep project APIs local.

These are limits, not silently completed requirements. CODEX.md is not fully
implemented.
