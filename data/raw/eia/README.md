# EIA Electricity Price Ingestion

- Dataset: EIA 2024 Electric Sales, Revenue and Average Price, Table 4
- Official source page: https://www.eia.gov/electricity/sales_revenue_price/
- Exact expected files: table_4_2024.xlsx (official download is named table_4.xlsx)
- Format/schema: XLSX, 2024 title on first row; State, Industrial and Commercial columns on row 3
- Place source files in: data/raw/eia/
- Account/agreement: No API key or account is required for the public workbook.
- Preprocessing command: .venv/bin/python pipelines/ingest/eia.py --offline

The official Table 4 download is cached with its source URL and a checksum. The 2024 title is validated so a later release cannot silently be mislabeled. Annual industrial electricity prices in cents/kWh are state revenue/sales averages joined through Census STATE_NAME. They are cost proxies, not data-center tariffs.

After ingestion, rebuild the joined store with: .venv/bin/python pipelines/build_feature_store.py --offline

Raw artifacts and metadata are immutable; use --refresh to request versioned new downloads. A failed source retains its last valid processed output, or remains missing while the application continues using its valid store.

