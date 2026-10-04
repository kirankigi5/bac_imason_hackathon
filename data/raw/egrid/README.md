# EPA eGRID Ingestion

- Dataset: EPA eGRID 2023 revision 2
- Official source page: https://www.epa.gov/egrid/detailed-data
- Exact expected files: egrid2023_data_rev2.xlsx
- Format/schema: XLSX; ST23 sheet, machine headers on row 2, YEAR, PSTATABB, STC2ERTA, STCNPR
- Place source files in: data/raw/egrid/
- Account/agreement: No account is required for public releases.
- Preprocessing command: .venv/bin/python pipelines/ingest/egrid.py --offline

Automatic acquisition uses the exact download linked by EPA. If downloading fails, place that workbook here. STC2ERTA is lb CO2e/MWh and is converted to kg CO2e/MWh; STCNPR is converted from fraction to percent. Values are state production averages joined to county STUSPS, explicitly labeled state proxies. They do not establish power availability or site electricity procurement.

After ingestion, rebuild the joined store with: .venv/bin/python pipelines/build_feature_store.py --offline

Raw artifacts and metadata are immutable; use --refresh to request versioned new downloads. A failed source retains its last valid processed output, or remains missing while the application continues using its valid store.

