# FEMA National Risk Index Ingestion

- Dataset: FEMA NRI December 2025 v1.20 county indicators, including wildfire
- Official source page: https://fema.maps.arcgis.com/home/item.html?id=39485e8035d446a5bff03259508ae355
- Exact expected files: Automatically cached nri-2025-count.json and nri-2025-{0,1000,2000,3000}.json; manual fallback: NRI_Table_Counties.csv or its official ZIP
- Format/schema: ArcGIS JSON pages, or CSV with STCOFIPS, WFIR_RISKS, DRGT_RISKS, IFLD_RISKS, HRCN_RISKS, HWAV_RISKS and RISK_SCORE
- Place source files in: data/raw/fema/
- Account/agreement: The FEMA-owned public ArcGIS layer does not require a key. If unavailable, use the download/export offered by FEMA.
- Preprocessing command: .venv/bin/python pipelines/ingest/fema.py --offline

Automatic acquisition uses the FEMA_NationalRiskIndex county feature service, ordered pagination, and a separate count check. Missing/incomplete pages are rejected. CSV fallback is joined by STCOFIPS; new Connecticut planning-region geography matches the 2024 county master. Hazard scores are national relative risk percentiles, not event probabilities. Wildfire is supplied by FEMA's wildfire indicator; no separate USDA wildfire source is claimed.

After ingestion, rebuild the joined store with: .venv/bin/python pipelines/build_feature_store.py --offline

Raw artifacts and metadata are immutable; use --refresh to request versioned new downloads. A failed source retains its last valid processed output, or remains missing while the application continues using its valid store.

