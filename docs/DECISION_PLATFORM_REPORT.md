# Decision Platform Backend Report

Verified October 3, 2026 (America/New_York). This report supersedes the earlier
conversational report for backend features and verification counts.

This is the backend-phase verification snapshot (167 tests). The subsequent
[frontend integration report](FRONTEND_INTEGRATION_REPORT.md) records the integrated
workspace and latest 185-test verification; pending frontend statements below are
historical to this backend phase.

## Completion Table

| Area | Implemented And Verified | Status / Limitation |
| --- | --- | --- |
| Official feature foundation | 3,109 counties, 71,471 evidence rows, 90.5% configured-metric completeness | Unchanged; public processed features remain active |
| LLM adapters | Swappable OpenAI Responses, OpenRouter structured-chat, Gemini and local fallback | All three remote adapters tested; Gemini live success verified |
| Live account check | Gemini `gemini-3.5-flash-lite`: intent, location explanation and ranking-change explanation | All three passed in LLM mode; previous OpenAI account remains credit-blocked |
| No-key operation | Three fallback operations exercised against the production server | Passed; no key required for ranking, maps or explanation |
| Decision trace | Actual ranks, scores, checks, drivers, weaknesses, alternatives and source evidence | Backend-computed, deterministic |
| Feasibility | All four statuses, structured checks and explicit reasons | Real requested MW capacity remains conditional; no utility approval inferred |
| Metric quality | Raw value, score, unit, source/year/date, type, status, confidence, caveat and artifact hash | Categorical source quality, not prediction accuracy |
| Ranking diff | Exact fields, ranks, scores, contributions, deltas, constraint transitions and top-N movements | Both profiles evaluated on one current release; not a historical-release replay |
| Explanation graph | Six sections with stable nodes and evidence references | No LLM-invented structure or trained decision-tree model |
| Comparison | Raw values, quality, rank, score, contributions, feasibility and exact directional pair deltas | Eligibility precedes score; both excluded means no recommended winner |
| Project storage | Full canonical profile, selection/compare state, revision, snapshot and timestamps in SQLite | Local single-user only; authentication not implemented |
| Audit | Atomic state/event writes, source/message, interpreted changes, old/new values and ranking effects | Append-only local hash chain; not externally signed or administrator-proof |
| Versioning | Data-release, scoring and normalization identifiers | Included in search, conversation rankings, detail, trace, diff, comparison and saved snapshots |
| Cache | Stable canonical hashes, 32-entry / 64 MiB LRU, isolated returned objects | Includes release/scoring/normalization, weights and constraints; no cross-version reuse |
| Missing evidence | Available/missing metric counts, completeness and major site-specific unknowns | Missing values remain null; unknown hard requirements cannot pass |
| Safety | Canonical allowlisted constraints, grounded fact references and mandatory caveats | No guaranteed MW, dedicated fiber, utility approval, parcel finding, tariff or community support |
| Automated tests | 41 Python + 126 application tests | 167 passed; 41 backend-pass tests and 26 Gemini/grounding tests added |
| TypeScript / production | Type checks and optimized Next.js build | Passed; all decision/project API routes are dynamic |
| Offline rebuild | Reused all seven processed source caches and the same release | Feature/evidence hashes and original FCC CSV hash unchanged |
| HTTP smoke | Real-data conversation, create/read, audited chat update, trace, compare, diff and conflict | Passed against production with a temporary SQLite database |
| Browser smoke | Desktop/mobile intake, real ranking/map, explanations and constraint transitions | Development and production passed at 1440x1000 and 390x844; no console/worker errors |

## Provider Status

Server configuration now selects Gemini `gemini-3.5-flash-lite`. Google's model
list accepted the saved server-side key and included that model. Live verification
at 2026-10-04 02:40:34 UTC (October 3 locally) passed intent parsing, location
explanation and ranking-change explanation, all in LLM mode, using actual processed
county evidence. Deterministic no-key fallback also passed. No data was seeded or
model trained for this verification.

The Gemini transport uses a fixed Google `generateContent` endpoint, the
`x-goog-api-key` header and JSON Schema under `generationConfig.responseFormat`.
The `APPLICATION_JSON` MIME enum follows Google's [official API reference](https://ai.google.dev/api/generate-content#v1beta.TextResponseFormat).
An initial MIME-string request failed HTTP 400 safely; the corrected enum passed
all three operations. Shared strict intent and fact-ID validation remain mandatory.

Additional live checks exposed a model turning a soft water preference into a
drought cutoff, asking unnecessary clarification, and omitting ranking-change
facts. The prompt now distinguishes soft preferences from explicit limits and
names required comparison/change references. Backend validation rejects
unrequested hard additions/removals or changed thresholds and falls back as a
whole; a recognized complete intake cannot become incomplete through extraction.
Hard limits must match the deterministic parser's supported explicit forms.
Genuine ambiguity on an already complete project can still ask clarification.
Invalid model output is not silently accepted as a new user requirement.

An attempted enum containing the whole larger change-fact catalog was rejected
by Google HTTP 400, so it was not retained. Every selected fact ID is instead
checked against the actual catalog server-side; unknown IDs still force fallback.
Final three-operation verification passed after these corrections. Earlier live
failures remain evidence that provider availability is not a guarantee of every
future response; the safe fallback and per-operation health remain active.

Earlier OpenAI `gpt-4.1-mini` verification returned fallback for every operation
after HTTP 429. A separate minimal request identified `credit_balance_exhausted`.
Billing retries were stopped. OpenAI's [official error-code documentation](https://developers.openai.com/api/docs/guides/error-codes)
distinguishes exhausted credits from transient rate limiting. Those OpenAI account
limitations do not block the now-verified Gemini provider.

Earlier in this pass, OpenRouter accepted its supplied key but reported no
remaining key credits; its three operation calls also fell back. The OpenRouter
adapter remains available through environment configuration. Its strict output
and required-parameter routing follow [OpenRouter's structured-output documentation](https://openrouter.ai/docs/guides/features/structured-outputs).

All three remote adapters enforce a 20-second timeout, reject incomplete/refused/malformed
outputs and validate schema/fact references in the shared provider layer. Raw
provider messages and credentials are not returned. Allowlisted billing/rate
codes and HTTP status are exposed in observed health. Unknown keys/models disable
the remote path. GET health does not call a paid provider; POST verification is
development-only unless explicitly enabled. Health resets to unverified after
configuration changes or process restarts.

A configuration diagnostic accidentally included the credential that had been
entered into the provider-name field. The user was notified to rotate that key
and put its replacement only in `OPENAI_API_KEY`. Credentials must never be
placed into provider/model names or shared in chat.

Mocked HTTP adapter tests exercise all three successful operations for all three
providers. They prove request handling and grounding, **not live account access**.
No-key tests reject any network access; the production no-key verification also
passed all three operations using real feature/evidence payloads.

## API Contracts

All new endpoints validate strict request schemas and return no-store responses.
Bad JSON/schema is 400, missing profile requirements 422, unknown IDs 404, stale
project revisions 409, and unavailable deterministic storage 503.

| Method / Path | Input / Result |
| --- | --- |
| `GET /api/locations/{id}/decision-trace` | `project_id` UUID or encoded `project` JSON query, but not both |
| `POST /api/locations/{id}/decision-trace` | `{project}` or `{project_id}`; returns trace and `explanation_graph.root` |
| `POST /api/ranking/diff` | `{before_project, after_project, location_ids?, top_n?}`; IDs capped at 100, top N 1-100 |
| `POST /api/compare` | `{project, location_ids}`; two to four unique county IDs |
| `POST /api/locations/compare` | Existing `{project, locationIds}` contract retained with richer backend output |
| `POST /api/projects` | `{name, project?, source?, user_message?}`; returns 201 with canonical state |
| `GET /api/projects` | Latest 50 projects |
| `GET /api/projects/{id}` | State, revision, timestamps, saved ranking and CURRENT/STALE/NOT_EVALUATED freshness |
| `PATCH /api/projects/{id}` | Required `expected_revision`; optional partial `project`, `name`, `source`, `user_message` |
| `GET /api/projects/{id}/history` | Ordered events with local integrity check |
| `GET /api/project/status` | Disabled/unverified/available/degraded observed provider health |
| `POST /api/project/status` | Explicit three-operation verification; 403 in production unless enabled |

Complete projects require capacity, workload, geography, go-live year and at least
one explicit priority or constraint. Project creation supports incomplete drafts,
but drafts do not receive ranking snapshots. PATCH merges partial fields; if
weights are supplied, all seven weights are required. Client-supplied ranking
snapshots are rejected. Selected and comparison county IDs are validated.

Saved chat requests to `/api/project/converse` include `projectId` and
`expectedRevision`. Chat updates start from the stored canonical profile, not an
untrusted client replacement. `source: "filters"` intentionally supplies the new
profile directly. Each accepted update commits state, snapshot and audit together;
explanation-only requests do not add change events.

## Decision Semantics

- `FEASIBLE`: observed county-screening requirements pass, with complete screening categories and no requested-capacity diligence flag. Never means a parcel or project is approved.
- `CONDITIONALLY_FEASIBLE`: no observed hard failure, but requested capacity, missing screening categories, stale inputs or site diligence remain.
- `INSUFFICIENT_DATA`: a required hard metric or every active scoring category is unknown. The candidate is excluded, without claiming a measured failure.
- `INFEASIBLE`: an observed hard requirement fails. The failed check and source are returned explicitly.

Positive drivers are the three largest actual weighted contributions. Weaknesses
are active categories below 65/100, sorted by score; their genuine contributions
remain nonnegative. Graph metric/check references resolve to stable evidence IDs
containing county, metric and raw artifact hash. Alternatives include exact factor
contribution differences. All trees are built from engine results before any
language rendering.

Metric quality is exposed for every evidence indicator used in explanation and
comparison, including missing entries. FCC availability, state electricity prices,
state carbon and county risk context are screening proxies. ACS statistical
estimates are not direct site measurements. Missing/stale/demo statuses are kept
distinct. Confidence labels describe evidence coverage and source scope, never
model accuracy or a probability that a facility can be built.

Diffs expose newly failed, newly unknown, newly passed and removed required
checks separately. Removing a failed constraint is not described as observing it
pass. Old/new ranks are null for excluded candidates. Pairwise impacts are first
county minus second; rounded factor differences plus `rounding_delta` reproduce
the displayed total score difference. A high numerical score does not override
failed or unknown hard requirements.

## Persistence And Integrity

Node.js 22.13 or newer is required for the built-in [`node:sqlite` API](https://nodejs.org/api/sqlite.html); verification
used Node.js 25.8.1. DB defaults to `data/projects/projects.sqlite` and can be
overridden with `PROJECT_DB_PATH`. File permissions are 0600. SQLite uses WAL,
foreign keys, a bounded busy timeout, prepared statements and `BEGIN IMMEDIATE`
transactions. Revision checking occurs again inside the write transaction.
An audit insertion failure rolls back the project state. SQL triggers reject
audit UPDATE/DELETE. Hashes link ordered events, and current state must agree with
the last event before an update can commit.

Audit events retain source, original message, interpreted exact field changes,
old/new canonical values, ranking effects, versions, revision and timestamp.
Ranking effects re-evaluate both profiles on one captured release. Prior saved
versions are retained explicitly; changes in a data release are not attributed
to project edits. Historic snapshots are marked stale rather than silently
overwritten on GET.

There is no authentication, authorization or multi-user tenancy. These endpoints
are intended for a trusted local application. An administrator can alter SQLite
or its triggers, so the hash chain must not be marketed as tamper-proof. This pass
does not introduce a project picker, session cookie, graph visualization or
public-hosting security layer.

## Versions And Cache

Current identifiers:

```text
data_release_id: ec0ed269269ed0f45e5b
scoring_version: county-screening-v2.0.0
normalization_version: county-normalization-84306f8fe6b3416e8e36
```

Data ID is the atomic release fingerprint. Normalization ID hashes the manifest's
recorded rules/effective bounds. Scoring version is an explicit implementation
constant and must be bumped for future scoring behavior changes.

Canonical hashing sorts object keys, geographic sets and constraint IDs. Ranking
hash includes scored project state, weights, constraints and all versions.
Selection/compare IDs and priority-signal context do not change ranking math, but
are included in diff-specific keys so their exact updates cannot be lost.
Comparison/trace keys include ranking identity and selected county IDs. Cached
values are copied before returning; LRU is bounded by both entry count and bytes.
LLM prose is not cached as a deterministic result.

## Files Changed

New implementation files:

```text
apps/web/lib/backend/{cache,decisions,http,ranking-diff,comparison}.ts
apps/web/lib/decision-engine/{decision-trace,metric-quality}.ts
apps/web/lib/project/{repository,persistence}.ts
apps/web/lib/llm/{health,verification,openrouter-transport,gemini-transport}.ts
apps/web/app/api/locations/[locationId]/decision-trace/route.ts
apps/web/app/api/ranking/diff/route.ts
apps/web/app/api/compare/route.ts
apps/web/app/api/projects/route.ts
apps/web/app/api/projects/[id]/route.ts
apps/web/app/api/projects/[id]/history/route.ts
apps/web/scripts/{verify-llm,verify-backend}.mjs
docs/DECISION_PLATFORM_REPORT.md
```

New test files:

```text
apps/web/lib/backend/decision-platform.test.ts       14 tests
apps/web/lib/project/persistence.test.ts             10 tests
apps/web/lib/llm/health.test.ts                       18 tests
apps/web/lib/llm/gemini-transport.test.ts             25 tests
```

Modified contracts/integration:

```text
apps/web/lib/types/domain.ts
apps/web/lib/data/store.ts
apps/web/lib/decision-engine/{feasibility,scoring,explanations,explanation-facts,ranking-changes}.ts
apps/web/lib/llm/{schemas,provider,openai-transport,prompts}.ts
apps/web/lib/project/conversation.ts
apps/web/app/api/project/{converse,status}/route.ts
apps/web/app/api/locations/{search,compare}/route.ts
apps/web/app/api/locations/[locationId]/{route.ts,explain/route.ts}
apps/web/components/chat/ChatPanel.tsx
apps/web/package.json
.gitignore
.env.example
README.md
```

`.env.local` contains local credentials and is ignored. No pipeline ingestion,
raw source data or processed indicator values were manually changed. No new
production dependency was added; SQLite is built into the required Node runtime.

## Verification And Remaining Work

- Python: 41 passed; application: 126 passed, including 41 backend additions and 26 Gemini/grounding additions. Existing tests were preserved.
- New tests cover all statuses, exact drivers/contributions/provenance, graph references, missing fiber, exact diffs/top-N/constraint transitions, directional comparisons, versioned cache isolation, API validation, unknown IDs and overclaim prevention.
- SQLite tests cover create/read/reopen, drafts, selections, snapshot staleness, chat/filter sources, revision conflict, append-only triggers, state consistency and transactional rollback after audit failure.
- Provider tests cover all three adapters' three-operation mock success, timeout, malformed/partial/refused output, no-key networking prevention, safe errors, billing diagnostics, configuration changes and production verification guard. Gemini tests also cover header-only credentials, thought filtering, unsafe model identifiers, invented evidence references, independent key selection, unrequested hard limits/removals, exact thresholds and incomplete extraction of a complete intake.
- Gemini live browser intake and location explanation passed in LLM mode on desktop, using the real feature store with a nonblank map and no console/worker errors. Production no-key HTTP/provider checks and desktop/mobile browser flows were repeated successfully; client-bundle scanning found zero saved-credential matches.
- TypeScript and production build passed. Development/production HTTP smoke and production no-key provider checks passed using temporary DBs outside user storage.
- Playwright passed at 1440x1000 and 390x844 in development and production: intake, real processed rankings, score-matching map markers, grounded explanations, repeated water weighting, actual deltas, audience mode, wildfire filtering and FCC constraints. Nonblank canvas checks passed; no console/worker errors or horizontal overflow.
- The browser's wildfire plus fiber >=90 workflow retained 224 eligible counties; nine Connecticut planning regions remained excluded for unknown FCC evidence.
- Offline build preserved the release and both store hashes. FCC raw CSV SHA-256 remains `926bc4e1a4235770089f8fd64f58aff5e81b99b7e97cc3ae8aa32f90bfd2199c`.

Remaining blockers are the original FCC ZIP not yet present, and evidence gaps
for actual site MW, interconnection approval,
dedicated fiber, negotiated tariffs, parcels, local approvals and community
acceptance. Nine Connecticut planning regions remain without matched FCC evidence.
None of these gaps was filled with fabricated values.

Live LLM verification is complete through Gemini. Next: connect the existing
frontend to the backend graph, saved-project APIs and explicit
feasibility/quality details. That integration is separate from this backend pass.
CODEX.md is not fully implemented overall. No custom ML, future scenarios,
construction scoring, scraping, approval prediction, Pareto optimization,
sophisticated sensitivity analysis or parcel-level site selection was added.
