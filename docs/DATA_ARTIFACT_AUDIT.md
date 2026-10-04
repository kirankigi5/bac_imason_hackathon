# Data Artifact Audit

Audited October 4, 2026. Sizes below use decimal MB (1,000,000 bytes); threshold
lists are cumulative and include files at the threshold. No dataset, schema,
score, provenance field or original artifact was modified or deleted.

## Runtime Contract

The application reads `DATA_DIR/manifest.json`, resolves its `store_path`, reads
that release's `location_features.json`, and loads individual county files from
`evidence/` when `partitioned_evidence` is true. The verified current pointer is
`releases/ec0ed269269ed0f45e5b`. It represents 3,109 counties, 71,471 evidence
rows and 90.5% configured-metric completeness.

`data/processed/` is an ingestion/build input cache, not a web runtime dependency.
Raw downloads and interim county geometry are also pipeline inputs, not runtime
requirements. Flat root JSON/Parquet/DuckDB exports and historical releases are
not used by the current web runtime, but the full official-artifact tests use
raw/processed caches and aggregate/Parquet/DuckDB outputs.

| Directory / File | Bytes | Format | Runtime Required? | Reproducible? |
| --- | ---: | --- | --- | --- |
| `data/raw/` | 486,797,699 | ZIP, CSV, DAT, XLSX, JSON, text, provenance sidecars | No | Public/manual reacquisition; exact vintages and hashes must be retained |
| `data/interim/counties.parquet` | 14,532,131 | Parquet with geometry/FIPS | No | Yes, from Census boundaries |
| `data/interim/counties.metadata.json` | 605 | JSON provenance | No | Yes, with source acquisition |
| `data/processed/census.json` | 10,116,502 | JSON | No | Yes, ACS adapter |
| `data/processed/egrid.json` | 4,851,446 | JSON | No | Yes, eGRID adapter |
| `data/processed/eia.json` | 2,517,453 | JSON | No | Yes, EIA adapter |
| `data/processed/fcc.json` | 24,566,901 | JSON | No | Yes, with the official manual FCC summary |
| `data/processed/fema.json` | 19,562,839 | JSON | No | Yes, FEMA adapter |
| `data/processed/noaa.json` | 2,702,892 | JSON | No | Yes, NOAA adapter |
| `data/processed/wri_aqueduct.json` | 7,832,408 | JSON | No | Yes, Aqueduct spatial adapter |
| `data/feature_store/manifest.json` | 10,973 | JSON release pointer/metadata | Yes | Yes, publication pipeline |
| Active release `location_features.json` | 23,286,313 | JSON | Yes | Yes, published engineering output |
| Active release `evidence/*.json` (3,109 files) | 101,501,181 total | Partitioned JSON | Yes | Yes, publication pipeline |
| Active release `evidence_store.json` | 101,491,857 | Aggregate JSON | No for current partitioned runtime; yes for full tests | Yes |
| Active release `location_features.parquet` | 1,064,957 | Parquet | No; used by full tests/export consumers | Yes |
| Active release `evidence.parquet` | 784,228 | Parquet | No; used by full tests/export consumers | Yes |
| Active release `features.duckdb` | 3,682,304 | DuckDB | No; used by full tests/export consumers | Yes |
| Active release `manifest.json` | 10,973 | JSON | Root pointer is sufficient for runtime; retain in full bundle | Yes |
| Complete active release (3,115 files) | 231,821,813 | Mixed exports and JSON partitions | Bundle includes runtime and full exports | Yes, when identical inputs are available |
| Entire `data/feature_store/` | 1,056,484,787 | Active/historical releases and duplicate flat exports | Only selected JSON subset | Yes, but previous exact inputs must be available |
| `data/seeds/seed_location_features.json` | 13,426 | Explicitly artificial fallback JSON | Only fallback build input; not the real runtime | Source-controlled fixture; preserved unchanged |
| `data/projects/` | 4,062,136 at audit | Private SQLite/WAL/SHM | Created on demand for saved projects | User state is not reproducible and must not be published |

No standalone GeoJSON or shapefile was found. Census shapes and WRI geodatabase/
CSV layers are inside their ignored ZIPs. No repository browser screenshots were
found. The 118,628-byte, four-page `Data Center Locator.pdf` is the project brief;
its extracted text was separately checked for secrets. It is small enough to
retain as source documentation. Installed libraries and build outputs are not
source artifacts and are ignored.

## Data Terms And Provenance

Observed inputs are public county/state statistics or public WRI indicators.
No paid vendor export, restricted Census microdata, licensed FCC location-level
Fabric archive, personal address dataset or commercial source was identified.
This is an inventory observation, not a blanket legal clearance for every future
download. Keep source terms and attribution with any future distributed bundle.

- EPA eGRID, Census ACS/boundaries, FEMA NRI, NOAA nClimDiv and EIA are the
  official public statistical sources named in `config/data_sources.yaml`.
  Retain their source names, URLs, vintages and transformations.
- WRI Aqueduct 4.0 is third-party licensed data, not unrestricted federal data.
  Its [official FAQ](https://www.wri.org/aqueduct/faq) identifies CC BY 4.0,
  attribution and sharing guidance. Derived county water indicators must retain
  WRI attribution and describe the area-weighted transformation. Access dates
  are recorded in the existing evidence; do not invent them.
- The supplied FCC CSV is Fixed Broadband Summary by Geography, not CostQuest's
  location-level Fabric. The [FCC distinguishes the licensed Fabric](https://help.bdc.fcc.gov/hc/en-us/articles/7412732399003-Fabric-FAQs).
  Preserve the summary's actual December 31, 2025 vintage and September 29, 2026
  export date. Follow the portal's applicable terms for redistribution; do not
  assume a downloadable file grants permission to redistribute all FCC products.
- The current original FCC ZIP is absent. The unchanged CSV is the actual source
  artifact, and its provenance must not be presented as ZIP provenance.

## Acquisition Documentation

The small manual-download READMEs under `data/raw/*/README.md` remain eligible
source documentation because pipeline tests require them. Every raw dataset,
CSV/ZIP export and metadata sidecar remains ignored; no raw data is staged.
The README exception does not make downloadable artifacts eligible.

| Source | Committed Instructions | Official Acquisition |
| --- | --- | --- |
| County boundaries | [Census boundaries](../data/raw/counties/README.md) | Official Census 2024 county ZIP |
| EPA eGRID | [eGRID](../data/raw/egrid/README.md) | Official 2023 revision 2 XLSX |
| Census ACS | [ACS](../data/raw/census/README.md) | API with optional key, or public bulk DAT tables |
| WRI Aqueduct | [Aqueduct](../data/raw/wri_aqueduct/README.md) | Public 4.0 baseline ZIP; WRI attribution required |
| FEMA | [FEMA NRI](../data/raw/fema/README.md) | Official county service/download |
| NOAA | [NOAA](../data/raw/noaa/README.md) | County temperature normal file |
| EIA | [EIA](../data/raw/eia/README.md) | Official Table 4 XLSX |
| FCC | [FCC](../data/raw/fcc/README.md) | Manual technology-specific fixed summary; immutable original ZIP preferred |
| USGS | [USGS](../data/raw/usgs/README.md) | Optional land-cover source; not an active scoring input |

## Runtime Distribution Decision

Generated `data/processed/` and `data/feature_store/` artifacts were already
ignored before the original pre-push task. Those existing exclusions remain.
That task made no data architecture, Git LFS, acquisition or runtime changes;
the subsequent explicitly authorized deployment preparation is described below.

The original pre-push recommendation was a separate release artifact. In the
subsequent Railway preparation, the user authorized the **minimal current JSON
runtime bundle**, not full aggregate/Parquet/DuckDB exports. It retains both
manifests, active features and 3,109 evidence partitions: 124,820,413 uncompressed
bytes in 3,112 files, compressed to 7,997,302 bytes. It is locally generated and
ignored, not committed, uploaded or published. No download URL exists yet.
Restoration now runs only at container startup, with pinned content/checksum
validation and no seeded fallback. See [Railway deployment](RAILWAY_DEPLOYMENT.md)
for the bundle metadata and operator publication instructions. The pipeline,
original artifacts and historical exports remain unchanged.

Alternatives explicitly presented:

1. GitHub Release artifact / deployment-time restoration: keep the source
   repository small and preserve the exact release, without bundling raw inputs.
   Full raw-artifact tests still require local source caches.
2. Minimal current JSON runtime in normal Git: root manifest, active
   `location_features.json` and 3,109 county evidence partitions are 124,809,440
   bytes total. Largest file is 23,286,313 bytes; individual partitions are small.
   This can run the current app without changing scoring, but adds about 124.8 MB
   of generated data and does not satisfy the full raw/Parquet/DuckDB tests.
3. Rebuild from public/manual sources using `make data`: already supported.
   FCC still needs manual acquisition. Live sources can change, so a fresh build
   cannot promise this exact release fingerprint without the original inputs.
4. Git LFS: possible for large exports, but changes storage/download workflow.
   It was not installed or silently configured.

No real runtime data is included in the source-controlled repository.
The tiny existing seed fixture remains source-controlled solely as an explicitly
labeled fallback, not as a substitute for the verified real release.

## Size Thresholds

The complete filesystem inventory found **40 files >=10 MB**, **14 >=50 MB**,
and **5 >=100 MB**, all ignored. These include generated/dependency files.
The data-only counts are 24, 9 and 4 respectively. No eligible source file
is >=10 MB.

GitHub documents warning/block limits in **MiB**, not decimal MB:
[official large-file guidance](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github).
The user's stricter >=100,000,000-byte rule is enforced here, even for aggregate
evidence JSON that is below GitHub's 100 MiB ceiling.

### Files >=100 MB

| File | Bytes | MB | Git Handling |
| --- | ---: | ---: | --- |
| `data/raw/wri_aqueduct/aqueduct-4-0-water-risk-data.zip` | 261,527,511 | 261.53 | Ignored; preserve locally |
| `apps/web/.next/cache/turbopack/v16.3.8-b0fad0d4/00000330.sst` | 112,955,881 | 112.96 | Ignored; preserve locally |
| `data/feature_store/evidence_store.json` | 101,491,857 | 101.49 | Ignored; preserve locally |
| `data/feature_store/releases/ec0ed269269ed0f45e5b/evidence_store.json` | 101,491,857 | 101.49 | Ignored; preserve locally |
| `data/feature_store/releases/06bf91904c812c0e467f/evidence_store.json` | 101,483,100 | 101.48 | Ignored; preserve locally |

### Files >=50 MB

| File | Bytes | MB | Git Handling |
| --- | ---: | ---: | --- |
| `data/raw/wri_aqueduct/aqueduct-4-0-water-risk-data.zip` | 261,527,511 | 261.53 | Ignored; preserve locally |
| `apps/web/.next/cache/turbopack/v16.3.8-b0fad0d4/00000330.sst` | 112,955,881 | 112.96 | Ignored; preserve locally |
| `data/feature_store/evidence_store.json` | 101,491,857 | 101.49 | Ignored; preserve locally |
| `data/feature_store/releases/ec0ed269269ed0f45e5b/evidence_store.json` | 101,491,857 | 101.49 | Ignored; preserve locally |
| `data/feature_store/releases/06bf91904c812c0e467f/evidence_store.json` | 101,483,100 | 101.48 | Ignored; preserve locally |
| `data/raw/fcc/bdc_us_fixed_broadband_summary_by_geography_D25_29sep2026.csv` | 90,551,238 | 90.55 | Ignored; preserve locally |
| `apps/web/node_modules/@next/swc-darwin-arm64/next-swc.darwin-arm64.node` | 88,930,328 | 88.93 | Ignored; preserve locally |
| `apps/web/.next/dev/cache/turbopack/v16.3.8-b0fad0d4/00000092.sst` | 83,599,826 | 83.60 | Ignored; preserve locally |
| `data/feature_store/releases/6d136a5b026fac4aac27/evidence_store.json` | 69,617,090 | 69.62 | Ignored; preserve locally |
| `data/feature_store/releases/dba1254afeb0bcb99d7f/evidence_store.json` | 69,617,090 | 69.62 | Ignored; preserve locally |
| `data/feature_store/releases/a9e47aeb35ff4dad5200/evidence_store.json` | 69,573,780 | 69.57 | Ignored; preserve locally |
| `apps/web/.next/cache/turbopack/v16.3.8-b0fad0d4/00000331.sst` | 65,260,438 | 65.26 | Ignored; preserve locally |
| `.venv/lib/python3.14/site-packages/pyogrio/.dylibs/libgdal.38.3.12.4.dylib` | 60,993,648 | 60.99 | Ignored; preserve locally |
| `data/feature_store/releases/a9e47aeb35ff4dad5200/location_features.json` | 58,675,900 | 58.68 | Ignored; preserve locally |

### Files >=10 MB

| File | Bytes | MB | Git Handling |
| --- | ---: | ---: | --- |
| `data/raw/wri_aqueduct/aqueduct-4-0-water-risk-data.zip` | 261,527,511 | 261.53 | Ignored; preserve locally |
| `apps/web/.next/cache/turbopack/v16.3.8-b0fad0d4/00000330.sst` | 112,955,881 | 112.96 | Ignored; preserve locally |
| `data/feature_store/evidence_store.json` | 101,491,857 | 101.49 | Ignored; preserve locally |
| `data/feature_store/releases/ec0ed269269ed0f45e5b/evidence_store.json` | 101,491,857 | 101.49 | Ignored; preserve locally |
| `data/feature_store/releases/06bf91904c812c0e467f/evidence_store.json` | 101,483,100 | 101.48 | Ignored; preserve locally |
| `data/raw/fcc/bdc_us_fixed_broadband_summary_by_geography_D25_29sep2026.csv` | 90,551,238 | 90.55 | Ignored; preserve locally |
| `apps/web/node_modules/@next/swc-darwin-arm64/next-swc.darwin-arm64.node` | 88,930,328 | 88.93 | Ignored; preserve locally |
| `apps/web/.next/dev/cache/turbopack/v16.3.8-b0fad0d4/00000092.sst` | 83,599,826 | 83.60 | Ignored; preserve locally |
| `data/feature_store/releases/6d136a5b026fac4aac27/evidence_store.json` | 69,617,090 | 69.62 | Ignored; preserve locally |
| `data/feature_store/releases/dba1254afeb0bcb99d7f/evidence_store.json` | 69,617,090 | 69.62 | Ignored; preserve locally |
| `data/feature_store/releases/a9e47aeb35ff4dad5200/evidence_store.json` | 69,573,780 | 69.57 | Ignored; preserve locally |
| `apps/web/.next/cache/turbopack/v16.3.8-b0fad0d4/00000331.sst` | 65,260,438 | 65.26 | Ignored; preserve locally |
| `.venv/lib/python3.14/site-packages/pyogrio/.dylibs/libgdal.38.3.12.4.dylib` | 60,993,648 | 60.99 | Ignored; preserve locally |
| `data/feature_store/releases/a9e47aeb35ff4dad5200/location_features.json` | 58,675,900 | 58.68 | Ignored; preserve locally |
| `apps/web/.next/dev/cache/turbopack/v16.3.8-b0fad0d4/00000093.sst` | 45,487,197 | 45.49 | Ignored; preserve locally |
| `.venv/lib/python3.14/site-packages/pyarrow/libarrow.2500.dylib` | 45,416,616 | 45.42 | Ignored; preserve locally |
| `.venv/lib/python3.14/site-packages/_duckdb.cpython-314-darwin.so` | 45,408,576 | 45.41 | Ignored; preserve locally |
| `data/raw/census/acsdt5y2024-b23025.dat` | 39,968,046 | 39.97 | Ignored; preserve locally |
| `data/processed/fcc.json` | 24,566,901 | 24.57 | Ignored; preserve locally |
| `.venv/lib/python3.14/site-packages/pyarrow/libarrow_flight.2500.dylib` | 23,550,688 | 23.55 | Ignored; preserve locally |
| `data/feature_store/location_features.json` | 23,286,313 | 23.29 | Ignored; preserve locally |
| `data/feature_store/releases/ec0ed269269ed0f45e5b/location_features.json` | 23,286,313 | 23.29 | Ignored; preserve locally |
| `data/feature_store/releases/06bf91904c812c0e467f/location_features.json` | 23,285,512 | 23.29 | Ignored; preserve locally |
| `data/raw/egrid/egrid2023_data_rev2-895cd81dd866.xlsx` | 21,213,301 | 21.21 | Ignored; preserve locally |
| `data/raw/egrid/egrid2023_data_rev2.xlsx` | 21,213,301 | 21.21 | Ignored; preserve locally |
| `data/feature_store/releases/6d136a5b026fac4aac27/location_features.json` | 21,148,869 | 21.15 | Ignored; preserve locally |
| `data/feature_store/releases/dba1254afeb0bcb99d7f/location_features.json` | 21,148,869 | 21.15 | Ignored; preserve locally |
| `data/processed/fema.json` | 19,562,839 | 19.56 | Ignored; preserve locally |
| `data/raw/census/acsdt5y2024-b01003.dat` | 18,313,708 | 18.31 | Ignored; preserve locally |
| `apps/web/node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.18.7.dylib` | 18,231,688 | 18.23 | Ignored; preserve locally |
| `data/raw/census/acsdt5y2024-b19013.dat` | 17,917,916 | 17.92 | Ignored; preserve locally |
| `apps/web/node_modules/@rolldown/binding-darwin-arm64/rolldown-binding.darwin-arm64.node` | 16,703,408 | 16.70 | Ignored; preserve locally |
| `apps/web/.next/dev/cache/turbopack/v16.3.8-b0fad0d4/00000098.sst` | 16,216,798 | 16.22 | Ignored; preserve locally |
| `.venv/lib/python3.14/site-packages/pyarrow/libarrow_compute.2500.dylib` | 15,241,024 | 15.24 | Ignored; preserve locally |
| `data/interim/counties.parquet` | 14,532,131 | 14.53 | Ignored; preserve locally |
| `apps/web/.next/dev/cache/turbopack/v16.3.8-b0fad0d4/00000099.sst` | 12,441,940 | 12.44 | Ignored; preserve locally |
| `data/raw/counties/cb_2024_us_county_500k.zip` | 11,626,066 | 11.63 | Ignored; preserve locally |
| `.venv/lib/python3.14/site-packages/pyproj/proj_dir/share/proj/proj.db` | 10,223,616 | 10.22 | Ignored; preserve locally |
| `.venv/lib/python3.14/site-packages/pyogrio/proj_data/proj.db` | 10,207,232 | 10.21 | Ignored; preserve locally |
| `data/processed/census.json` | 10,116,502 | 10.12 | Ignored; preserve locally |
