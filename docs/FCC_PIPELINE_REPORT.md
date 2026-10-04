# FCC Pipeline Verification

Verified October 3, 2026. This is the update after the earlier conversational-AI
snapshot. No UI redesign, custom ML training or stretch features were added.

## Outcome

| Area | Verified Result | Remaining Limitation |
| --- | --- | --- |
| Acquisition | Official manually supplied CSV, schema inspected before parsing | Original ZIP is absent from `data/raw/fcc/`; requested from user |
| Raw preservation | 90,551,238-byte CSV unchanged; SHA-256 checked before and after ingestion | CSV provenance is explicit, not presented as ZIP provenance |
| Vintage | December 31, 2025 observation; September 29, 2026 export | Filename-derived dates are labeled; CSV has no date fields |
| FCC schema | 616,170 rows, 14 columns; separate Fiber technology and B/R service rows | No provider-row aggregation or speed-based technology inference |
| FIPS joins | 3,100 exact matches; 124 out-of-scope and eight former CT counties explicitly audited | Nine current CT planning regions stay missing; no allocation |
| Engineering | Business fiber at 100/20 Mbps scored; four additional context metrics retained | Mass-market availability, not data-center connectivity capacity |
| Validation | Duplicates, invalid FIPS, fractions, denominator consistency and speed ordering checked | Unsupported schemas stop only FCC; last good source retained as stale |
| Stores | JSON, Parquet, DuckDB and county evidence partitions rebuilt atomically | 3,109 counties, 71,471 evidence rows, 90.5% metric completeness |
| Explainability | Raw values, filters, speed threshold, denominator, dates and artifact hash retained | Missing CT evidence includes its explicit geography-mismatch reason |
| Tests | 41 Python and 59 application tests pass; TypeScript and production build pass | No live remote LLM test without credentials |

## Source Artifact

Present: `data/raw/fcc/bdc_us_fixed_broadband_summary_by_geography_D25_29sep2026.csv`.
Absent: original FCC ZIP and `data/interim/fcc/` extracted directory.

SHA-256:
`926bc4e1a4235770089f8fd64f58aff5e81b99b7e97cc3ae8aa32f90bfd2199c`.
The artifact's bytes, size and modification time were not changed. A separate
metadata sidecar records when the pipeline first observed it, rather than
inventing a download timestamp. The original ZIP provenance cannot be verified
until the ZIP is supplied. Once supplied, it takes precedence over any CSV;
the adapter reads it in place and stores both its hash and its CSV member hash.

Official portal and manual fallback details are in `data/raw/fcc/README.md`.
The [FCC map documentation](https://help.bdc.fcc.gov/hc/en-us/articles/10467446103579-How-to-Use-the-FCC-s-National-Broadband-Map)
describes technology/speed/service filtering and served-unit area summaries.
[FCC Fabric definitions](https://help.bdc.fcc.gov/hc/en-us/articles/16842264428059-About-the-Fabric-What-a-Broadband-Serviceable-Location-BSL-Is-and-Is-Not)
distinguish serviceable structures from their unit counts and enterprise services.

## Scored Definition

```text
fiber_coverage_pct = 100 * speed_100_20
where geography_type = County
  and area_data_type = Total
  and biz_res = B
  and technology = Fiber
  and total_units is known and positive
```

Use the FCC's already aggregated served-unit fraction directly. Do not sum or
average providers, business/residential filters, urban/rural records or technology
groups. `Cable/Fiber` is not `Fiber`. The denominator is the exported county unit
count, not business-only units or BSL buildings. The existing 0-100 normalization
and category aggregation apply unchanged. This is explicitly a county-level
mass-market connectivity proxy, not backbone capacity, dark fiber, route diversity,
an SLA, latency or site-level data-center readiness.

Unscored context metrics are `fiber_business_gigabit_coverage_pct`,
`fiber_residential_100_20_coverage_pct`,
`fixed_terrestrial_business_100_20_coverage_pct`, and `broadband_total_units`.
The FCC processed source has 15,509 records: 15,500 joined metrics and nine
explicit missing-fiber records with source provenance. Missing values are never
converted to zero; a reported zero fraction with a positive denominator is retained.

Example: Kent County, Michigan, FIPS `26081`, reports `speed_100_20=0.505614484`
under the selected business/Fiber filters. Its raw coverage is 50.5614484% and
its infrastructure score is 50.561448/100, directly traceable to this source.
The residential fraction and gigabit coverage remain separate evidence.

## Join Audit

The file contains 3,232 county FIPS: 3,100 match the 2024 Census master, 124 are
outside the contiguous-US/DC scope, and eight are former Connecticut counties.
There are no unexplained unmatched FIPS. Current planning regions `09110`,
`09120`, `09130`, `09140`, `09150`, `09160`, `09170`, `09180`, and `09190` have
no exact source match. They retain null fiber scores and cannot satisfy a hard
fiber requirement. No name matching, area weighting or guessed crosswalk is used.

## Verification

- `make test`: 41 Python and 59 application tests pass, including 19 focused FCC
  adapter tests and an official-artifact integration test checking all counties.
- Engine tests prove actual published FCC evidence drives infrastructure scores
  and hard constraints. Provider tests cover both available fiber as a proxy and
  missing Connecticut evidence, without inventing backbone capacity.
- `make lint` and `npm run build` pass.
- Offline rebuilds reuse validated source caches and the unchanged published
  release. JSON/Parquet/DuckDB content and checksums are tested.
- Playwright production acceptance passes at 1440x1000 and 390x844: intake,
  actual rankings/map, explanations, priority changes and ranking deltas,
  community mode, wildfire constraints, real fiber thresholds, missing CT fiber,
  and restoring feasible results. Map canvas pixels are nonblank; no console
  errors or horizontal overflow were observed.
- A standalone nationwide fiber minimum of 90% qualifies 374 counties. With the
  browser's additional wildfire limit of 60, 224 remain. The nine Connecticut
  regions are excluded for missing evidence, never supplied with fabricated fiber.

## Still Unavailable

Original ZIP provenance, dedicated data-center fiber, utility capacity,
interconnection readiness, negotiated tariffs, parcel suitability, local approval
and community acceptance are not established. Metric completeness is data coverage,
not prediction accuracy. `CODEX.md` remains incomplete overall; this phase is the
FCC data integration and verification, not the stretch-feature implementation.
