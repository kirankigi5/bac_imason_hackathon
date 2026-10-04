# Conversational Intake Correctness

Verified October 4, 2026 (America/New_York). This pass fixes only the supplied
short-answer/state-management transcript. No further UI redesign was performed.

## Root Cause

1. The local parser understood a bare numeric capacity, but configured providers
   still delegated short answers to the LLM. Qualifiers such as `around 500`
   were not handled locally. The model could omit a partial answer or request
   a clarification instead of accepting it.
2. The extraction guard rejected lost information only when local parsing would
   complete the entire intake. Lost partial capacity/workload/year updates were
   not protected. A model clarification took precedence over the deterministic
   next-field question, even when it concerned an accepted or optional field.
3. Server defaults lacked U.S. geography, geography remained a required intake
   field, and nationwide scope alternated between an omitted state list and an
   empty list. The frontend's earlier country default did not fix provider
   clarifications or direct/saved server entry points.

The frontend already accepted the returned canonical profile and serialized
updates; no independent intake profile or new state machine was necessary.
Regression tests now verify the returned profile and revision on every next
request, including after a subsequent metadata-read failure.

## Corrections

- New server/frontend profiles default to `{country: "US", states: []}`. Cloning
  copies state/region arrays rather than sharing mutable default geography.
- Geography is not a missing required field. Empty states means all supported
  U.S. counties. Country/state/region schema validation remains unchanged.
- Deterministic follow-up order is capacity, workload, go-live year, then one
  priority or hard constraint. It is calculated from the updated canonical state.
- Greeting and contextual short answers bypass model extraction. Capacity forms
  include `500`, `500 MW`, `500MW`, `around 500` and `roughly 500`. Single-word
  workload and year answers use the current missing-field context.
- A numeric capacity such as `2050 MW` is not also interpreted as a go-live year.
- `all`, `all states`, `nationwide` and `Anywhere in the US` clear optional scope
  without resetting accepted project answers. Manual reset produces the same
  explicit empty state list.
- Extraction validates recognized profile answers even during partial intake.
  Model attempts to overwrite accepted intake fields without an explicit locally
  recognized update are rejected. Invented clarifications for accepted fields
  or optional geography fall back deterministically. Genuine locally recognized
  contradictions still request clarification.
- Provider interfaces, selection, HTTP transports, explanation generation and
  credentials are unchanged. Only intent parsing/validation and its context prompt
  were adjusted; no new provider was added.

## Exact Transcript

The browser submitted these messages through the existing composer, not a
synthetic frontend state injection. Both local and configured Gemini runs passed.

| Message | Accepted State / Next Step | Saved Revision |
| --- | --- | --- |
| Initial saved draft | U.S., empty states; no ranking | 1 |
| `hello` | Ask capacity | 2 |
| `500` | Capacity 500 MW; ask workload | 3 |
| `training` | AI_TRAINING; ask go-live year | 4 |
| `2050` | Target year 2050; ask priorities | 5 |
| `clean energy and low water risk` | Priorities accepted; real ranking/map available | 6 |

Capacity, workload and year survive every subsequent turn. Each question is asked
once; geography is never required. The existing accepted-chat audit behavior
increments revision for each turn, including the greeting. The next request uses
that returned revision. Initial partial turns never expose a map/ranking.

In the Gemini run, the first four turns were parsed by the deterministic engine
without a model call. The final priority turn succeeded in Gemini LLM mode. Two
bounded live intent calls were made overall: the final priority message and the
later optional Michigan/Ohio chat request. No active three-operation provider
verification or explanation request was added.

Manual Michigan/Ohio selection matched the canonical geography returned for
`Only Michigan and Ohio.`. Resetting to Anywhere in U.S. returned
`{country: "US", states: []}` and preserved 500 MW, AI_TRAINING and 2050.
These optional edits finished at revision 9 in the isolated browser projects.

## Files Changed

Production intake/state code:

- `apps/web/lib/project/defaults.ts`
- `apps/web/lib/project/validation.ts`
- `apps/web/lib/llm/intent-parser.ts`
- `apps/web/lib/llm/provider.ts` (intent extraction only)
- `apps/web/lib/llm/prompts.ts` (intent prompt only)
- `apps/web/lib/llm/schemas.ts` (geography normalization and clarification text)
- `apps/web/lib/frontend/use-workspace.ts` (canonical defaults only)
- `apps/web/components/filters/StateSelector.tsx` (state-list output only)

Tests/documentation:

- `apps/web/lib/project/intake.test.ts` (new)
- `apps/web/app/workspace.test.tsx`
- `apps/web/lib/llm/intent-parser.test.ts`
- `apps/web/lib/llm/health.test.ts`
- `README.md`
- `docs/INTAKE_CORRECTNESS_REPORT.md` (new)

Existing shape assertions now expect an explicit empty state list. The health test
uses a multi-field request to actually exercise the remote transport, because a
short capacity answer now intentionally bypasses it. The legacy saved-draft test
creates an actual pre-default geography-free fixture rather than treating a newly
created, correctly defaulted project as legacy. Existing behavioral assertions
remain intact.

## Verification

| Check | Result |
| --- | --- |
| `make test` | 41 Python + 182 application tests passed; 223 total |
| New regressions | 27 cases beyond the prior 155 app tests, including capacity variants, all four workloads, year context, optional geography, partial loss, invented clarifications and genuine contradictions |
| Frontend integration | Exact saved transcript passed with local parsing and a deliberately faulty configured-provider mock; only the final priority answer needed model extraction |
| Revision recovery | Metadata read failure after an accepted answer did not lose the new profile or revision |
| `npm run lint` | TypeScript passed |
| `npm run build` | Next.js production build passed |
| Desktop local browser | Exact transcript, real map, manual/chat state parity and nationwide reset passed at 1440x900 |
| Desktop Gemini browser | Same sequence passed with live Gemini priority extraction |
| Layout/console | Screenshots inspected; no horizontal overflow, page/console/worker errors; nonblank map pixels verified |
| Protected foundation | All 62 pre-edit hashes match for engine/data/config/pipeline/API/transport/persistence and page/CSS files |
| Client credentials | 20 client assets scanned against three configured secret values; zero occurrences |

Tests and browser projects use temporary SQLite databases, not the user's project
database. Scoring, ranking, feasibility, evidence, explanation graphs, datasets and
visual layout are unchanged. The release remains `ec0ed269269ed0f45e5b`.
The 2050 target is project context, not a new future forecast or scenario engine.

Verification artifacts:

```text
/tmp/intake-complete-tests.log
/tmp/intake-production-build.log
/tmp/intake-local-browser.log
/tmp/intake-gemini-browser.log
/tmp/intake-protected-baseline-20261004.json
/tmp/datacenter-map-browser-20261003/intake-smoke.mjs
/tmp/intake-{local,gemini}-1440-{capacity,workload,year,priorities,map,nationwide}.png
```

This completes the scoped intake correction, not every requirement in CODEX.md.
