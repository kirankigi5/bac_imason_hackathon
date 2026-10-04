# Selected-Location Explanation Disclosure

Verified October 4, 2026. This is a frontend presentation change only.

This historical pass is superseded for primary explanations by
[the selected-location summary implementation](SELECTED_LOCATION_SUMMARY_REPORT.md).

## Default Summary

Selected county details and the Why dialog share a concise, deterministic summary
derived from the existing decision trace, never from a truncated model response.
The summary includes rank (or Excluded), score, exact feasibility status, up to
three actual positive weighted drivers, three unresolved risks when available,
and a final one-sentence bottom line. Tests bound the full summary, including its
headings and score labels, to 120 words.

Blocking failed/unknown required checks take precedence, followed by power
diligence, weak screening categories and remaining evidence gaps. This is a
presentation order, not a new risk score. Fewer available facts are never padded
with fabricated strengths or risks. Actual zero workforce scores remain zero;
missing values remain unknown. Workforce context is not resident acceptance;
connectivity scores are not parcel suitability or dedicated fiber findings.

Developer, Government and Community modes retain identical strengths, risks,
rank, score and feasibility. Only introductory emphasis and bottom-line language
change. A failed requirement cannot be overridden by a high numerical score.

## Detailed Evidence

- Expand reveals the unchanged backend graph and its full checks, drivers,
  alternatives, missing evidence and limitations.
- Full provider prose is fetched only after expansion, and remains in a further
  collapsed disclosure. A matching chat explanation is reused without another
  model request. Backend explanation generation and chat responses are unchanged.
- Evidence retains every original metric, value, source, vintage, type, caveat,
  transformation and hash. Each expanded metric exposes its complete original
  evidence JSON as well as the existing readable fields and official source link.
- Evidence also includes the complete decision graph and methodology/version
  disclosures. Raw metadata and full caveats are absent from the default summary.
- Changing county, criteria or audience resets the expanded explanation.

## Verification

| Check | Result |
| --- | --- |
| Complete test suite | 41 Python + 200 application tests passed; 241 total |
| New summary coverage | 17 cases covering audiences, real counties, missing fiber, failed checks, all four statuses and absent facts |
| Frontend integration | Lazy explanation request, exact graph identity, complete evidence JSON, audience invariance and context resets passed |
| TypeScript | `npm run lint` passed |
| Production | `npm run build` passed |
| Desktop browser | 1024x900, 1440x900 and 1920x900 passed; screenshots inspected |
| Potter County summaries | Developer 104 words; Government 100; Community 103 |
| Browser evidence | All 56 trace nodes and 23 evidence records matched original API responses |
| Browser state | Saved profile and revision unchanged by explanation/evidence controls |
| Browser rendering | Nonblank map pixels; no horizontal overflow, page, console or worker errors |
| Protected files | SHA-256 checks matched all 70 backend, API, project, LLM, domain, pipeline, configuration and processed-data files |

Browser checks used an isolated temporary SQLite database and the existing local
deterministic provider. No paid LLM calls or credential changes were made. Mobile,
comparison prose and ordinary conversation presentation were not redesigned.
The verification project used 550 MW, MIXED, 2045 and default project weights;
Potter ranked #5 with 81.1 for those weights. This does not replace the user's
different project weights or imply any change to scoring.

## Changed Files

- `apps/web/lib/frontend/location-summary.ts`
- `apps/web/components/location/LocationSummary.tsx`
- `apps/web/components/location/LocationDetail.tsx`
- `apps/web/components/location/MetricDetails.tsx`
- `apps/web/app/globals.css`
- `apps/web/components/location/location-summary.test.tsx`
- `apps/web/app/workspace.test.tsx`
- `README.md`
- `docs/EXPLANATION_DISCLOSURE_REPORT.md`

## Local Artifacts

- `/tmp/explanation-protected-baseline-20261004.json`
- `/tmp/explanation-complete-tests.log`
- `/tmp/explanation-production-build.log`
- `/tmp/explanation-browser-smoke.log`
- `/tmp/datacenter-map-browser-20261003/explanation-smoke.mjs`
- `/tmp/explanation-{1024,1440,1920}-{selected,developer,government,community,expanded,evidence,workspace}.png`
