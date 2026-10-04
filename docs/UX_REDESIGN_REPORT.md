# Desktop UX Redesign Report

Verified October 4, 2026 (America/New_York). Frontend UX only, following
`AGENTS.md`, `CODEX.md` and `docs/project_specs/UX_DESIGN.md`. The latter is the
supplied UX authority; the different docs path in AGENTS.md does not exist.
CODEX.md is not fully implemented.

## Requested Report

| Area | Implemented And Verified |
| --- | --- |
| 1. Files changed | Four new frontend components, nine existing frontend/test files, README and this report; historical frontend report linked to this update. Full list below. |
| 2. Restructuring | Replaced permanent filters, location tabs and audit chrome with chat intake, one map workspace, criteria drawer and explicit secondary dialogs. No existing backend or map implementation removed. |
| 3. Landing flow | Empty chat input, planning prompt and quick starts. Only missing capacity, workload, go-live year and a priority/constraint are requested. The map mounts after backend readiness; conversation is preserved across the transition. |
| 4. U.S. default | New canonical frontend profiles contain `geography.country = US`; no country or mandatory state intake. Older saved drafts without geography receive the same audited default through the existing revision-checked PATCH endpoint. Backend validation is unchanged. |
| 5. State selector | Anywhere in U.S. or searchable multi-state checkboxes. No selection means all supported contiguous-U.S./DC counties. Chat and the selector update the same canonical profile. Complete profiles rerank through the existing filter API. |
| 6. Workspace | 70% map / 30% persistent chat at both tested desktop sizes. Compact project summary, top priorities, requirement count and five-county shortlist. Selection opens real rank/score/status, six categories, drivers, weaknesses and three primary actions. |
| 7. Progressive disclosure | Graph only after Why; full diff only after a ranking-change request. Evidence shows source/metric/vintage/caveat before expansion. Comparisons, saved-project list, Project > History, revisions, service status and versions are secondary. Audience controls are inside explanation views. |
| 8. Verification | 41 Python + 155 application tests, TypeScript and production build passed. Production desktop browsers at 1440x900 and 1280x800 passed, with screenshots inspected, zero console/page errors and no horizontal overflow. Real rankings, traces and evidence verified. |
| 9. Remaining UX | No blocking issue found in the tested desktop flow. Dense candidate clusters still require map zoom or shortlist selection. Long evidence/history/diff views intentionally scroll. Mobile, streaming chat and broader accessibility audits were not part of this phase. |

## Files

New:

- `apps/web/components/workspace/Dialog.tsx`
- `apps/web/components/filters/StateSelector.tsx`
- `apps/web/components/filters/CriteriaEditor.tsx`
- `apps/web/components/location/AudienceControl.tsx`
- `docs/UX_REDESIGN_REPORT.md`

Restructured or updated:

- `apps/web/app/page.tsx`
- `apps/web/app/globals.css`
- `apps/web/lib/frontend/use-workspace.ts`
- `apps/web/components/chat/ChatPanel.tsx`
- `apps/web/components/filters/TopProfileBar.tsx`
- `apps/web/components/location/LocationDetail.tsx`
- `apps/web/components/projects/ProjectToolbar.tsx`
- `apps/web/app/page.test.tsx`
- `apps/web/app/workspace.test.tsx`
- `README.md`
- `docs/FRONTEND_INTEGRATION_REPORT.md` (historical-report pointer only)

The existing DecisionMap, ExplanationTree, MetricDetails, FeasibilityStatus,
ComparePanel, RankingDiffPanel and DecisionHistory are reused without changing
their deterministic contracts. No production dependency was added. No backend
API, provider, model, scoring, feasibility, evidence, configuration or pipeline
file was changed.

## Interaction Details

Intake asks one missing requirement at a time using the existing backend follow-up
logic. A complete country-free request immediately reveals the map and shortlist;
an incomplete request remains in chat. Optional intake scope does not fabricate a
chat instruction or require a premature search.

The criteria drawer edits a local draft. Applying submits project fields,
priorities, explicit numeric requirements and states together. Cancel/Escape
leaves the canonical profile unchanged. Revision conflicts appear inside the
drawer; explicit reload accepts newer saved state and discards the obsolete draft.
The native dialog supports keyboard dismissal and focus return.

Criteria updates show a concise change notice, with increased priorities ahead
of redistributed decreases. Backend leader movements appear when available.
The detailed diff endpoint is not fetched merely because criteria changed.
Collapsed chat change records retain the complete accepted old/new values.

Graph nodes and metric references come directly from the decision trace. Why
opens the tree first; optional audience prose is expandable. A Why chat response
is reused when project, county and audience match, avoiding a duplicate LLM call.
Changing audience can request new grounded wording but does not change canonical
project state or deterministic trace/ranking/evidence.

The selected-county panel remains inspectable outside the top 20. With no eligible
counties, All Candidates still opens the actual excluded records; county search
can select Connecticut planning regions and show INSUFFICIENT_DATA with missing
FCC fiber values. Missing measurements are never turned into measured zeros.

Saved Projects shows name, update date and snapshot status. Reopening reruns the
existing current-release search. Stale snapshots remain labeled as stale and are
not presented as current rankings. Project settings retain save/new/reload and
audited history without occupying the main map/chat surface.

## Verification

| Check | Result |
| --- | --- |
| `make test` | 41 pipeline tests + 155 application tests passed, 196 total |
| Existing coverage | All original assertions retained; test navigation follows the new disclosure boundaries |
| Added UX coverage | Eleven tests: hidden intake surfaces, adaptive intake, country-free transition, optional states, atomic criteria, draft cancellation, lazy diffs, chat Why, legacy draft default, drawer conflict/reload and all-excluded inspection |
| `npm run lint` | TypeScript passed |
| `npm run build` | Optimized Next.js production build passed |
| Desktop browser | 1440x900 and 1280x800 end-to-end acceptance passed |
| Canonical state | Country-free intake; chat Michigan/Ohio scope; manual Anywhere reset and capacity update verified against API responses |
| Explanation | All 62 graph node IDs matched the actual backend trace; Community switch preserved the trace |
| Ranking diff | Lazy request verified; displayed contribution deltas matched backend values for 21 location deltas |
| Comparison | Exact directional factor impacts matched `/api/compare`; no frontend score calculation |
| Evidence | Official FCC vintage, proxy caveat and source URL rendered; Connecticut missing fiber stayed null and excluded |
| Persistence | Save, secondary saved-project navigation, reopen and URL reload preserved profile, county and comparison IDs |
| Keyboard | Escape dismissed state dialog and returned focus to Choose States |
| Map | Nonblank canvas pixel variance, actual ranked markers and changed pixels after zoom verified |
| Layout | Screenshots inspected for intake, map, selection, tree, criteria, diff, comparison, evidence, history and saved projects; no document horizontal overflow |
| Console | Zero observed console, page or worker errors in both successful production runs |
| Protected files | All 76 protected backend/config/pipeline/data SHA-256 values matched the before-edit baseline |
| Client secrets | 20 production client assets scanned against three configured secret values; zero occurrences |
| User server | Existing development server on http://127.0.0.1:3000 serves the app and local MapLibre worker successfully |

Unit integration tests use the actual route handlers, published real feature store
and temporary SQLite databases. No production database or dataset is altered by
the tests. The browser harness uses Playwright and installed Chrome against an
isolated production server with `LLM_PROVIDER=local`; it makes no paid provider
requests. Gemini configuration remains untouched, and its earlier live verification
is not claimed as a new test of this redesign.

Verification logs:

```text
/tmp/ux-complete-tests.log
/tmp/ux-production-build.log
/tmp/ux-protected-baseline-20261004.json
/tmp/datacenter-map-browser-20261003/ux-smoke.mjs
/tmp/ux-production-{1440,1280}-{intake,workspace,selected,why,changed,diff,
  criteria,compare,evidence,history,saved,excluded,canvas}.png
```

## Unchanged Foundation And Limits

Release `ec0ed269269ed0f45e5b` still contains 3,109 counties and 71,471 evidence
records with approximately 90.5% completeness across configured ranking metrics.
Scoring remains `county-screening-v2.0.0` and normalization remains
`county-normalization-84306f8fe6b3416e8e36`. There is no new dataset, model,
scenario engine, construction scoring, approval prediction or provider work.

The application remains a county screening tool. It does not establish usable
site MW, interconnection, dedicated fiber, actual tariffs, parcel approvals or
resident support. Missing FCC evidence in nine Connecticut planning regions and
the absent original FCC ZIP remain unchanged. Local project persistence has no
authentication; keep the server private. Mobile was not redesigned or reverified.
CODEX.md is not fully implemented.
