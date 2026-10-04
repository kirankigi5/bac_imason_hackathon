# USGS Manual Ingestion

- Dataset: USGS National Land Cover Database
- Official source page: https://www.usgs.gov/centers/eros/science/national-land-cover-database
- Expected file(s): official NLCD raster or county-derived land-cover export
- Expected format: GeoTIFF, ZIP, or CSV
- Place files in: `data/raw/usgs/`
- Account/agreement: follow USGS source instructions
- Preprocessing command: `python3 pipelines/ingest/usgs.py`

County-level land suitability should be precomputed before app use.

