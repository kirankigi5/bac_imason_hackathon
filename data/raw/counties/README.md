# Census County Boundary Ingestion

- Dataset: U.S. Census 2024 cartographic county boundaries
- Official source page: https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html
- Exact expected files: cb_2024_us_county_500k.zip
- Format/schema: ZIP containing SHP/DBF/SHX/PRJ, with GEOID, STATEFP, STUSPS, STATE_NAME, NAMELSAD and ALAND
- Place source files in: data/raw/counties/
- Account/agreement: No account is required for the public download.
- Preprocessing command: .venv/bin/python pipelines/build_feature_store.py --offline

The master covers contiguous U.S. states and DC. County FIPS are five-digit strings. Centroids are calculated in EPSG:5070 and converted to longitude/latitude. If the automatic boundary download fails, place the same official ZIP here; the current valid store remains usable.

After ingestion, rebuild the joined store with: .venv/bin/python pipelines/build_feature_store.py --offline

Raw artifacts and metadata are immutable; use --refresh to request versioned new downloads. A failed source retains its last valid processed output, or remains missing while the application continues using its valid store.

