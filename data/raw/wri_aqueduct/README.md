# WRI Aqueduct Ingestion

- Dataset: WRI Aqueduct 4.0 baseline annual water risk
- Official source page: https://www.wri.org/data/aqueduct-global-maps-40-data
- Exact expected files: aqueduct-4-0-water-risk-data.zip; alternatively one baseline GeoPackage with bws_score, bws_raw and geometry
- Format/schema: Official ZIP containing Aq40_Y2023D07M05.gdb, baseline_annual layer; or GeoPackage/SHP ZIP with the same baseline fields
- Place source files in: data/raw/wri_aqueduct/
- Account/agreement: WRI provides a direct public download. Attribute WRI Aqueduct under its CC BY 4.0 license; follow the official source terms.
- Preprocessing command: .venv/bin/python pipelines/ingest/wri_aqueduct.py --offline

The ZIP linked on WRI's page is downloaded automatically when available. Raw data stays unchanged. Basins are intersected with Census counties in EPSG:5070 and valid stress scores are weighted by overlap area. At least 80% county-area coverage is required; missing/no-data values are excluded. Arid raw sentinel 9999 is not interpreted as an actual withdrawal ratio. Baseline stress uses 1979-2019 historical data. Future layers in the archive are not used.

After ingestion, rebuild the joined store with: .venv/bin/python pipelines/build_feature_store.py --offline

Raw artifacts and metadata are immutable; use --refresh to request versioned new downloads. A failed source retains its last valid processed output, or remains missing while the application continues using its valid store.

