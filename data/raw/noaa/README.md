# NOAA County Climate Ingestion

- Dataset: NOAA NCEI nClimDiv county monthly temperature averages
- Official source page: https://www.ncei.noaa.gov/pub/data/cirs/climdiv/
- Exact expected files: climdiv-norm-tmpccy-v1.0.0-YYYYMMDD (the published release discovered from the official directory; currently 20260904)
- Format/schema: Fixed-width county normal records: NOAA state code, county suffix, element 02, period 0010, 12 monthly Fahrenheit values
- Place source files in: data/raw/noaa/
- Account/agreement: No account is required for these public bulk files.
- Preprocessing command: .venv/bin/python pipelines/ingest/noaa.py --offline

Automatic acquisition discovers the exact published filename from NOAA's official bulk directory. Use period 0010 (1991-2020); average the 12 monthly temperatures and convert F to C. NOAA state codes are not state FIPS and are mapped explicitly before joining the county suffix. Historical averages are cooler-climate planning proxies, not future projections or engineered cooling demand. Unmatched geography stays missing.

After ingestion, rebuild the joined store with: .venv/bin/python pipelines/build_feature_store.py --offline

Raw artifacts and metadata are immutable; use --refresh to request versioned new downloads. A failed source retains its last valid processed output, or remains missing while the application continues using its valid store.

