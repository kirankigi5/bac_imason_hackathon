# Census ACS Ingestion

- Dataset: 2020-2024 ACS five-year county estimates
- Official source page: https://www.census.gov/programs-surveys/acs/data/summary-file.2024.html
- Exact expected files: acs5-2024-counties.json OR acsdt5y2024-b01003.dat, acsdt5y2024-b19013.dat, acsdt5y2024-b23025.dat
- Format/schema: JSON Census API array with header; or original pipe-delimited table-based summary files with GEO_ID and B01003_E001 / B19013_E001 / B23025_E001,E003,E005
- Place source files in: data/raw/census/
- Account/agreement: The API may require CENSUS_API_KEY. Official public bulk tables do not require an account.
- Preprocessing command: .venv/bin/python pipelines/ingest/census.py --offline

The command first tries the documented Census API; HTML redirects, authentication errors and invalid schemas trigger the official bulk-file fallback. Only GEO_ID=0500000US plus five county digits is selected. FIPS is state+county; margins of error remain in the immutable raw tables. Negative suppression codes become missing, not zero. ACS population, income, labor force and unemployment are context estimates; workforce capacity does not imply community approval.

After ingestion, rebuild the joined store with: .venv/bin/python pipelines/build_feature_store.py --offline

Raw artifacts and metadata are immutable; use --refresh to request versioned new downloads. A failed source retains its last valid processed output, or remains missing while the application continues using its valid store.

