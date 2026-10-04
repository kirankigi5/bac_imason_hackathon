# Selected-Location Main Explanation

Verified October 4, 2026. Scope: selected-location presentation and the additive
grounded summary service only. Existing engine, datasets, decision traces,
evidence, map, conversation parsing and APIs remain unchanged.

## Layout

The county name is followed by one compact rank / score / human-readable
feasibility row. Immediately below it is a 50-80 word, three-sentence explanation.
The default also contains three real driver scores, three human-readable risks,
Compare, Evidence and View decision breakdown. Audience controls remain available.

The default no longer displays contribution points, effective weights, machine
status labels, technical identifiers, version strings, provenance, caveat lists,
the tree, an Expand control or a long audit explanation. View all risks discloses
remaining human-readable findings without inventing missing values.

## LLM Payload And Grounding

`POST /api/locations/{locationId}/summary` accepts the canonical project, audience
and optional saved revision. It obtains the original current ranking and trace,
then sends only compact facts to the existing configured structured provider:

- County name/state, actual rank, score and feasibility.
- Three positive drivers and two or three weak categories where available.
- Three prioritized unresolved risks and the original unavailable site findings.
- Current project priorities and requested MW.
- Important constraint labels, observed statuses and whether required.
- Short quality caveats distinguishing county indicators from power, interconnection,
  dedicated fiber, parcel suitability, approvals, resident acceptance and jobs.

No source hashes, version metadata, raw transformations, internal county IDs,
full graph or large source records are sent. No alternative is needed for this
short Why-here summary; existing comparison APIs remain unchanged.

Grounding follows the verified provider's fact-selection design: the LLM chooses
wording from approved sentences derived exclusively from those facts. The server
validates exactly three stages (recommendation, observed feasibility, diligence),
rejects unknown IDs or additional free-text claims, and enforces 50-80 words before
rendering. This is not unconstrained model prose. The model cannot calculate or
replace rank, score, feasibility or source values.

Developer emphasizes development commitment and capacity; Government emphasizes
public infrastructure review; Community emphasizes local water and land decisions.
These are changes in language, not separate decisions or new impact measurements.

## Fallback And Cache

The synchronous deterministic summary is visible immediately while the LLM runs.
Disabled providers, bounded transport failures, invalid schema/IDs, missing stages,
unsafe extra claims or excessive length return that same concise grounded fallback.
HTTP failure cannot make the panel empty, and late responses cannot replace the
newly selected county.

Browser and server caches reuse results for the same county, project identity,
saved revision, audience, rank/score and data/scoring/normalization identity.
Server keys also isolate provider/model/credential configuration; credential
fingerprints remain server-side. Concurrent matching requests share one generation.
Caches are bounded to 128 results; valid LLM results expire after 30 minutes and
provider fallback results after 30 seconds. Criteria, county, revision, ranking,
release or audience changes generate a fresh summary; ordinary rerenders do not.

## Secondary Details

View decision breakdown renders the original deterministic graph only on request.
It contains checks, drivers, contribution calculations, alternatives, missing
evidence and limitations, with no second long prose explanation or LLM call.
Changing context collapses it again.

Evidence retains raw/normalized values, source/vintage, type/status, caveats,
official links and complete original evidence JSON. Methodology/version/hash
details remain separately disclosed. A metric caveat is not repeated in its
collapsed label or an identical transformation field. Existing conversational
explanation responses and comparison prose are not changed by this pass.

## Verification

| Check | Result |
| --- | --- |
| Full suite | 41 Python + 237 application tests passed; 278 total |
| Provider grounding | Real structured call path, malformed/unsafe selections, complete fallback and excluded counties tested |
| Request/cache behavior | Concurrent deduplication, cache bounds/expiry, all identity changes, remount reuse and late replies tested |
| Summary API | Compact facts, cached generation, fallback, invalid input, incomplete intake and unknown county tested |
| TypeScript | `npm run lint` passed |
| Production | `npm run build` passed |
| Local browser | 1024x900, 1440x900 and 1920x900 passed; screenshots inspected |
| Live Gemini browser | Three successful LLM summaries: Developer 59, Government 63, Community 68 words |
| Browser caching | One summary request per audience; reopening and switching back reused it |
| Original findings | All 56 graph nodes and 23 evidence records matched original API output |
| Browser state | Audience/evidence/disclosure controls left saved profile and revision unchanged |
| Rendering | Nonblank map pixels; no horizontal overflow or page/console/worker errors |
| Protected files | All 72 protected original backend/data/API/map/intake files matched SHA-256 baselines |
| Credentials | No configured secrets found in 20 production client assets; keys remain server-side |

Browser fixtures used isolated temporary SQLite databases, not the user's saved
projects. Exactly three live Gemini generations were used for summary verification.
The Campbell fixture used 500 MW, AI_TRAINING, 2030 and default weights: #4, 81.3.
Different user weights can produce a different score without changing engine logic.
No model was trained and no new datasets or site findings were introduced.

## Files

Production changes are limited to the selected-location components, their CSS,
the page's selected-location props/audience control, compact fact/summary helpers,
the request hook, bounded cache and new summary route. The provider gained an
optional summary method; its existing parsing and full explanation methods and
transport implementations were not modified. Focused tests, existing UI assertions,
this report and README were updated to match the new requested presentation.

Artifacts: `/tmp/why-summary-complete-tests.log`,
`/tmp/why-summary-production-build.log`, `/tmp/why-summary-typescript.log`,
`/tmp/why-summary-{local,gemini}-browser.log`,
`/tmp/why-summary-protected-20261004.json`,
`/tmp/datacenter-map-browser-20261003/why-summary-smoke.mjs`, and
`/tmp/why-summary-{local,gemini}-{1024,1440,1920}-*.png`.
