# Sustainable AI Data Center Locator

BAC x iMason county-level decision platform for screening U.S. data-center
locations. A deterministic engine ranks processed official indicators against a
canonical project profile. Chat supports intake, and the map workspace exposes
rankings, comparisons, concise explanations and detailed source evidence.

No custom ML model has been trained. An optional server-side LLM helps interpret
requests and select verified explanation facts; it never computes scores or
changes the ranking. Without credentials, the app uses its deterministic fallback.

## Architecture

| Area | Location |
| --- | --- |
| Next.js application, APIs and server actions | `apps/web/` |
| Deterministic feasibility, ranking and explanations | `apps/web/lib/decision-engine/`, `apps/web/lib/backend/` |
| Canonical state, SQLite persistence and revision checks | `apps/web/lib/project/` |
| Provider adapters and grounding validation | `apps/web/lib/llm/` |
| Official acquisition, FIPS joins, engineering and provenance | `pipelines/` |
| Source registry and normalization rules | `config/` |
| Published runtime feature/evidence store | `data/feature_store/` (generated, locally retained) |

Ingestion runs only through explicit pipeline commands, never during searches.
The app reads the manifest-selected release and its county evidence partitions.
JSON, Parquet and DuckDB exports retain raw values, units, vintages,
transformations and source hashes. Missing measurements remain `null`.

## Local Setup

Requirements: Node.js 22.13 or newer (`node:sqlite`), npm, Python 3.11 or newer,
and enough disk space for official downloads and generated releases.

```bash
make install
# On a fresh checkout only; do not overwrite an existing credential file:
cp -n .env.example apps/web/.env.local
make data
make dev
```

Open http://localhost:3000. The app defaults to dark mode. MapLibre worker assets
are copied from the installed package before development and production builds.

Raw downloads, processed caches and runtime releases are not currently included
in Git. A fresh checkout needs a data build or restoration of a verified release
before use. The runtime-data distribution decision and exact sizes are documented
in [the data artifact audit](docs/DATA_ARTIFACT_AUDIT.md); no download URL is invented.
The current FCC source requires the manual export described below.

## Environment Variables

Use [`.env.example`](.env.example) as the template for `apps/web/.env.local`.
All credential fields are blank. Never commit real keys, set `NEXT_PUBLIC` secrets,
or include `.env.local` in a deployment image. Use server-side hosting secrets.

| Variable | Purpose |
| --- | --- |
| `LLM_PROVIDER` | `local` by default; optional `gemini`, `openai` or `openrouter` |
| `LLM_MODEL` | An account-supported model; OpenRouter needs a provider-qualified ID |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Gemini credential and supported alias |
| `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | Matching provider credential |
| `LLM_API_KEY` | Optional shared server-side credential alias |
| `DATA_DIR` | Feature-store root; defaults to `../../data/feature_store` from `apps/web` |
| `PROJECT_DB_PATH` | Private local SQLite database path |
| `APP_URL` | Base URL for optional verification scripts |
| `ALLOW_LLM_VERIFICATION` | `0` by default; active verification is development-only |
| `CENSUS_API_KEY` | Optional pipeline shell variable; public ACS bulk fallback works without it |

Python ingestion does not load Next.js `.env.local`; export a Census key in the
pipeline shell when needed. `MAP_TOKEN` is a reserved, unused template field;
the current map does not require it. Provider errors and invalid or ungrounded
responses fall back locally.

## Build Data

```bash
make data            # Reuse valid caches and acquire missing official sources
make data-offline    # Rebuild from existing local caches without network
.venv/bin/python pipelines/build_feature_store.py --refresh
```

The verified local release contains **3,109 counties**, **71,471 evidence rows**
and approximately **90.5% metric completeness**. It covers contiguous U.S.
states and DC, not Alaska, Hawaii or territories.

| Source | Current Vintage / Indicator |
| --- | --- |
| EPA eGRID | 2023 revision 2; state-average carbon intensity and generation mix |
| Census ACS | 2024 five-year estimates; population, income and workforce |
| WRI Aqueduct | 4.0 baseline; area-weighted county water stress |
| FEMA National Risk Index | December 2025; wildfire, drought, flood, hurricane and heat |
| NOAA nClimDiv | 1991-2020 county temperature normals |
| EIA | 2024 state-average industrial electricity prices |
| FCC | December 31, 2025 observations; business fiber summary exported September 29, 2026 |

Sources prefer official APIs/downloads and use manual instructions when necessary.
One unavailable source does not block the application. A failed source preserves
last-known-good data or remains missing. The pipeline requires a minimum valid
real store; only when no valid real release exists can it publish an explicitly
labeled seeded fallback. Check `manifest.json` for `data_mode = public_data`.

**FCC manual source:** obtain Fixed Broadband Summary by Geography from the
[official portal](https://broadbandmap.fcc.gov/data-download) for the configured
vintage, with separate County/Total/B/Fiber records, `total_units` and
`speed_100_20`. Keep its original ZIP in `data/raw/fcc/` unchanged. The adapter
also supports an official standalone CSV, with explicit CSV rather than ZIP
provenance. The existing local artifact is a CSV; its original ZIP is absent.
Do not substitute licensed location-level Fabric data, Cable/Fiber aggregates
or speed-only exports. Nine Connecticut planning regions remain missing because
the summary uses former counties; no allocation is fabricated.

See [source configuration](config/data_sources.yaml),
[FCC verification](docs/FCC_PIPELINE_REPORT.md) and
[data acquisition and redistribution notes](docs/DATA_ARTIFACT_AUDIT.md).
Source-specific manual READMEs under `data/raw/` are committed documentation;
all dataset files and metadata sidecars in those directories remain ignored.
Aqueduct-derived indicators require WRI attribution under its
[CC BY 4.0 terms](https://www.wri.org/aqueduct/faq).

## Tests And Production Build

```bash
make test            # Python pipeline tests and application tests
make lint            # TypeScript checks
cd apps/web
npm run build
npm run start
```

The full pipeline integration suite requires the local official raw artifacts,
processed caches and full published exports, not only a minimal runtime bundle.
On a fresh checkout, acquire the required FCC export and run `make data` first.
Verification uses existing local data and mocked/deterministic providers unless
an explicit live-provider verification command is run.

## Data And Hosting Caveats

- Scores are county-level screening indicators, not construction feasibility or
  predictions. Completeness measures evidence coverage, not model confidence.
- No dataset establishes guaranteed site MW, utility capacity, interconnection,
  permits, local approval, parcel suitability or community acceptance.
- eGRID and EIA are state averages, not supply commitments or negotiated tariffs.
  ACS workforce is context, not resident support or projected jobs.
- FCC mass-market fiber availability does not establish dedicated fiber,
  backbone capacity, route diversity, latency or an SLA.
- Historical baselines are not forecasts. Unknown hard-constraint evidence
  cannot pass; missing values are never assumed to be zero.
- Saved projects are **single-user, unauthenticated local SQLite state**.
  Do not expose the app or APIs publicly without access protection. Public
  multi-user hosting additionally needs authentication, authorization and
  rate limits. Keep SQLite on persistent storage.
- Raw/vendor artifacts are not redistributed by this repository. Source
  terms and attribution obligations are separate from any future code license.

## Demo And Documentation

Run locally, enter a complete project, explore the map, open View All Candidates,
and inspect a county's explanation or Evidence. Saved projects preserve criteria,
selection and revision history. No hosted demo or screenshots are published yet;
temporary browser verification artifacts are intentionally not committed.

Specifications: [CODEX.md](CODEX.md), [AGENTS.md](AGENTS.md),
[UX design](docs/project_specs/UX_DESIGN.md).

Implementation reports remain in [`docs/`](docs/), including
[decision-platform contracts](docs/DECISION_PLATFORM_REPORT.md),
[conversational AI](docs/CONVERSATIONAL_AI_REPORT.md),
[frontend integration](docs/FRONTEND_INTEGRATION_REPORT.md),
[UX redesign](docs/UX_REDESIGN_REPORT.md),
[intake correctness](docs/INTAKE_CORRECTNESS_REPORT.md),
[progressive disclosure](docs/EXPLANATION_DISCLOSURE_REPORT.md),
[selected summaries](docs/SELECTED_LOCATION_SUMMARY_REPORT.md),
[scoring tutorial](docs/SCORING_CLARITY_REPORT.md) and
[complete candidates](docs/ALL_CANDIDATES_REPORT.md).
Historical `/tmp` references are local verification records, not bundled assets.
`CODEX.md` is not fully implemented; stretch features are outside this phase.
