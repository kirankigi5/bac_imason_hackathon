# FCC Fixed Broadband Summary Acquisition

Official portal: https://broadbandmap.fcc.gov/data-download

Official interpretation: [National Broadband Map help](https://help.bdc.fcc.gov/hc/en-us/articles/10467446103579-How-to-Use-the-FCC-s-National-Broadband-Map)
and [BSL versus unit definitions](https://help.bdc.fcc.gov/hc/en-us/articles/16842264428059-About-the-Fabric-What-a-Broadband-Serviceable-Location-BSL-Is-and-Is-Not).

## Required Export

In Data Download, choose Summary Data, Fixed Broadband Summary by Geography,
for the configured data-as-of date, currently December 31, 2025. Preserve the
original ZIP in `data/raw/fcc/`. Use the FCC's normal download/account workflow;
never bypass portal access controls. No licensed location-level Fabric file is
required for this preaggregated summary. If login is required, download manually
under the applicable FCC terms.

Expected CSV member: `bdc_us_fixed_broadband_summary_by_geography_D25_<export-date>.csv`.
The adapter reads the ZIP directly and never rewrites or extracts over it. One
selected ZIP is required; multiple ZIPs are ambiguous. A standalone official CSV
in `data/raw/fcc/` is supported with explicit CSV provenance and a ZIP-absent
diagnostic, never disguised as ZIP provenance. Adding a ZIP selects it on the
next rebuild. Extracted files in `data/interim/fcc/` are not needed.

The current user-supplied artifact is a CSV, not a ZIP:
`bdc_us_fixed_broadband_summary_by_geography_D25_29sep2026.csv`, 90,551,238 bytes,
SHA-256 `926bc4e1a4235770089f8fd64f58aff5e81b99b7e97cc3ae8aa32f90bfd2199c`.
It was inspected as 616,170 rows with separate Fiber technology records.

## Schema And Derivation

Required fields are `area_data_type`, `geography_type`, `geography_id`,
`total_units`, `biz_res`, `technology`, `speed_02_02`, `speed_10_1`, `speed_25_3`,
`speed_100_20`, `speed_250_25`, and `speed_1000_100`.

`fiber_coverage_pct` is `100 * speed_100_20` from precisely
`geography_type=County`, `area_data_type=Total`, `biz_res=B`, `technology=Fiber`,
with a known positive `total_units` denominator. It measures the FCC-reported
unit-weighted availability of mass-market business fiber at at least 100/20 Mbps.
The exported denominator is county units, not BSL buildings or business-only
units. Business and residential rows are never added or averaged. Cable/Fiber
is not Fiber, and high speed alone is not evidence of Fiber.

Context-only evidence includes business fiber at 1000/100 Mbps, residential fiber
at 100/20 Mbps, business terrestrial broadband at 100/20 Mbps and total county
units. Only `fiber_coverage_pct` enters infrastructure scoring, through the
existing 0-100 normalization rule. This is not dedicated data-center connectivity,
backbone capacity, route diversity, latency, an SLA, or a site feasibility finding.

Blank/sentinel values, absent selected rows and absent/zero denominators stay
missing. A reported zero fraction with a positive denominator is a measured zero.
Duplicate county/service/technology rows, invalid FIPS, fractions outside [0,1],
inconsistent denominators and nonmonotonic speed coverage are rejected.

The inspected export matches 3,100 of the 3,109 county-master FIPS. Nine current
Connecticut planning regions have no exact match: the FCC file uses the eight
former Connecticut counties. Those records are explicitly audited and are not
allocated by name, area or estimated population. Alaska, Hawaii and territories
are outside the feature store's scope. Any other unmatched FIPS rejects FCC
ingestion; other sources and the last valid application store continue working.

## Vintage And Provenance

The filename's D25 token identifies December 31, 2025; J would mean June 30.
The export filename dates this snapshot September 29, 2026, not its observation
year. These dates are filename-derived and explicitly labeled as such because
the CSV contains no date columns. The registry pins the expected as-of date.
Retrieval metadata records when this pipeline first observed the manual artifact,
not a guessed original download time. Evidence retains both dates, SHA-256,
artifact filename/type, service/technology/speed filters and denominator. ZIP
ingestion also retains the member filename and SHA-256, with the original ZIP
hash as `raw_sha256`. Per-source diagnostics contain the full join audit.

## Insufficient Export Fallback

If the file lacks separate County/Total/B/Fiber rows with `total_units` and
`speed_100_20`, obtain the technology-specific Fixed Broadband Summary by Geography
export described above for the same vintage. An all-technology, Cable/Fiber or
speed-only summary cannot replace it. Stop only FCC ingestion, retain validated
last-known-good FCC data as stale when available, and keep the app running with
missing FCC evidence otherwise. No provider-row summing or fabricated fiber.

## Processing Commands

```bash
.venv/bin/python pipelines/ingest/fcc.py --offline
.venv/bin/python pipelines/build_feature_store.py --offline
make test
```

Sidecar metadata and processed outputs are created separately. Do not modify the
original artifact after its checksum is recorded; select a new official release
and update the configured vintage instead.
