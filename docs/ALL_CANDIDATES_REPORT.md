# All Candidates Fix

## Root Cause

The previous footer button did not open a candidates view or request a complete
ranking. It selected the first known county or reopened the selected-location
panel. Its data came from the current top-20 shortlist and excluded counties.
The existing search, conversation and saved-snapshot responses all deliberately
truncate eligible results to 20 and expose no pagination parameter.

The user explicitly approved an additive read-only Next.js server action to
bridge that transport limitation. No existing HTTP API or scoring implementation
was modified.

## Data Loading

`app/actions/candidates.ts` validates the current canonical project with the
existing project schema and completeness check, then returns the complete
existing backend `getRanking(project)` result. It makes no new scoring or ranking
decisions. Saved projects additionally require the current saved ID and revision;
the action rejects revision or scoring-criteria mismatches. Loading candidates
does not update saved state, snapshots or audit history.

The frontend resource is keyed by the complete project, saved ID, revision and
view mode. It suppresses old data immediately when that key changes and ignores
late successful/error responses after a context change or unmount. Transport
failures and backend validation/read errors are visible and provide Retry.
Next.js server actions cannot be aborted, so stale-response invalidation is explicit.

The dedicated All Ranked Candidates dialog contains eligible rows only, ordered
by their backend rank. Search covers the entire loaded ranking by county, state
name/code or county-plus-state, not just the visible page. Presentation uses 50
rows per page. Each row shows the original rank, county/state, screening score,
feasibility, up to three positive supporting factors from backend contributions
and their category scores, a concise conditional/insufficient-data warning and
View. No scores, contributions or eligibility statuses are recomputed.

The existing excluded-county capability is preserved through the separate View
Excluded Counties dialog, scoped to selected states. Excluded and insufficient
data counties are never mixed into the primary eligible ranking.

## Selection

View calls the existing `workspace.selectLocation` method. Only after a successful
selection does the dialog close and the detail panel open/focus. Capacity,
workload, years, geography, priorities, constraints and comparison selections are
preserved. Saved selections use the existing revision-checked PATCH and its
normal revision increment. On conflict the dialog stays open with the existing
visible error/reload flow; selection is not falsely reported as successful.

The selected row's display context is retained only for the same criteria and
data/scoring/normalization release. The map still receives only the original top
20 and uses its existing feature/decision-trace fetch to add an outside-top-20
selected marker and frame it. No map file or behavior was changed.

## Files Changed

- `apps/web/app/actions/candidates.ts`: new, approved read-only server action.
- `apps/web/lib/frontend/use-candidates.ts`: current-context loading and rejection
  of stale responses, plus visible failure/retry state.
- `apps/web/components/candidates/CandidatesView.tsx`: ranked/excluded list,
  county/state search, backend factor display and pagination.
- `apps/web/app/page.tsx`: correct button/dialog handler, separate excluded flow,
  existing selection integration and selected-row display/focus context.
- `apps/web/app/globals.css`: candidate-list styles only.
- `apps/web/app/actions/candidates.test.ts`: complete real ranking, canonical
  fields/revisions, read-only behavior, excluded scope and real store-read errors.
- `apps/web/components/candidates/candidates.test.tsx`: ordering, search,
  pagination, selection, loading/retry and stale-response regressions.
- `apps/web/app/workspace.test.tsx`: dedicated-view integration, outside-top-20
  detail loading, current saved scope/revisions and selection conflicts; existing
  saved-project and excluded-evidence tests updated to the corrected interaction.
- `README.md` and `docs/ALL_CANDIDATES_REPORT.md`.

## Verification

- Full suite: 41 pipeline and 278 application tests, 319 total.
- TypeScript: `npm run lint` passed.
- Production: `npm run build` passed.
- Real Chrome/Playwright flow at 1024x900, 1440x900 and 1920x900: complete intake,
  live map, save, open complete ranking, paginate, search, select outside top 20,
  close dialog, focus actual details and add the selected marker through the
  unchanged map. No console errors, horizontal overflow or clipped list text.
- Verification project: 3,109 eligible counties. Washtenaw County, MI was rank
  1,622 with score 56.5/100, matching the existing backend decision trace exactly.
  Map markers increased from 20 to 21 and the selected marker remained in-frame.
- Current saved revision was supplied on each list request. Selection changed
  only `selectedLocationId` and incremented revision 1 to 2. A subsequent accepted
  Michigan-only revision 3 loaded 83 eligible Michigan counties, not old U.S. rows.
- Unit regressions also verify stale async responses, real source read failure,
  Retry, canonical saved criteria, excluded evidence and selection conflicts.
- SHA-256 comparison: all 12,534 captured existing API/backend/scoring/data/
  pipeline/map/workspace files remain unchanged. The count includes partitioned
  feature/evidence artifacts, not just implementation files.

Logs: `/tmp/all-candidates-{complete-tests,typescript,production-build,desktop-browser}.log`.
Browser script: `/tmp/datacenter-map-browser-20261003/all-candidates-smoke.mjs`.
Screenshots: `/tmp/all-candidates-{1024,1440,1920}-{list,searched,map-selected,detail,state-scope}.png`.

Browser checks used the deterministic local provider and a temporary SQLite
database. No live LLM calls, dataset rebuilds, scoring changes or unrelated page
redesign were performed.
