"""Official source adapters. All network access happens during explicit ingestion."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlencode, urljoin

import geopandas as gpd
import pandas as pd
import pyogrio

from pipelines.common import (
    ROOT, VERSION, SourceContext, SourceError, atomic_json, fips, now, number,
    sha256, validate_measurements,
)
from pipelines.fcc import ingest_fcc, manual_artifact_signature

SOURCES = ("egrid", "census", "wri_aqueduct", "fema", "fcc", "noaa", "eia")


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == "a" and dict(attrs).get("href"):
            self.links.append(dict(attrs)["href"])


def load_counties(root=ROOT, offline=False, refresh=False) -> gpd.GeoDataFrame:
    context = SourceContext("counties", root, offline, refresh)
    cache = root / "data/interim/counties.parquet"
    if cache.exists() and not refresh:
        counties = gpd.read_parquet(cache)
    else:
        path, metadata = context.artifact(context.config["filename"], context.config["download_url"], "zip")
        counties = gpd.read_file(path)
        required = {"GEOID", "STATEFP", "STUSPS", "STATE_NAME", "NAMELSAD", "ALAND", "geometry"}
        if not required.issubset(counties.columns) or len(counties) < 3000:
            raise SourceError("County boundary release has an unexpected schema/row count")
        # First release covers the contiguous states and DC. Territories, AK and HI
        # need different spatial/temperature coverage and are explicitly out of scope.
        counties = counties[~counties.STATEFP.isin(["02", "15", "60", "66", "69", "72", "78"])].copy()
        counties["county_fips"] = counties.GEOID.map(fips)
        counties["county_name"] = counties.NAMELSAD
        counties["state_code"] = counties.STUSPS
        counties["state_name"] = counties.STATE_NAME
        points = counties.to_crs("EPSG:5070").centroid
        points = gpd.GeoSeries(points, crs="EPSG:5070").to_crs("EPSG:4326")
        counties["lat"], counties["lon"] = points.y, points.x
        counties = counties.to_crs("EPSG:4326").sort_values("county_fips").reset_index(drop=True)
        validate_counties(counties)
        cache.parent.mkdir(parents=True, exist_ok=True)
        temp = cache.with_name(f"counties.{os.getpid()}.tmp.parquet")
        counties.to_parquet(temp, index=False)
        os.replace(temp, cache)
        atomic_json(cache.with_suffix(".metadata.json"), {
            **metadata, "source_name": context.config["name"], "source_year": 2024,
            "processing_version": VERSION, "scope": "Contiguous U.S. states and DC",
        })
    validate_counties(counties)
    return counties


def validate_counties(counties):
    if counties.county_fips.duplicated().any() or not counties.county_fips.str.fullmatch(r"\d{5}").all():
        raise SourceError("County FIPS master has invalid/duplicate identifiers")
    if not counties.lat.between(-90, 90).all() or not counties.lon.between(-180, 180).all():
        raise SourceError("County centroids are invalid")
    if counties.geometry.isna().any() or counties.geometry.is_empty.any():
        raise SourceError("County geometries are missing")


def configured_artifact(context, kind):
    try:
        return context.artifact(context.config["filename"], context.config["download_url"], kind)
    except SourceError:
        # Users may retain the official filename instead of the configured cache name.
        return context.manual_file((".xlsx",) if kind == "xlsx" else (".zip", ".gpkg"))


def ingest_egrid(context, counties):
    path, metadata = configured_artifact(context, "xlsx")
    table = pd.read_excel(path, sheet_name="ST23", header=1)
    required = {"PSTATABB", "YEAR", "STC2ERTA", "STCNPR"}
    if not required.issubset(table.columns) or not 49 <= len(table) <= 55:
        raise SourceError("Expected eGRID ST23 state output emission-rate columns")
    if not (pd.to_numeric(table.YEAR) == 2023).all() or table.PSTATABB.duplicated().any():
        raise SourceError("Unexpected eGRID release year or duplicate states")
    states = table.set_index("PSTATABB")
    rows = []
    for county in counties.itertuples():
        if county.state_code not in states.index:
            continue
        state = states.loc[county.state_code]
        carbon = number(state.STC2ERTA, 0, 4000)
        clean = number(state.STCNPR, 0, 1)
        rows.append(context.metric(county.county_fips, "grid_carbon_intensity_kgco2e_mwh",
            None if carbon is None else carbon * 0.45359237, "kg CO2e/MWh", metadata,
            "STC2ERTA output CO2-equivalent lb/MWh * 0.45359237; state production-average proxy joined by STUSPS. Not lifecycle emissions or delivered electricity.", scope="state_proxy"))
        rows.append(context.metric(county.county_fips, "noncombustion_generation_pct",
            None if clean is None else clean * 100, "%", metadata,
            "STCNPR noncombustion generation fraction * 100; includes nuclear, hydro, wind, solar and geothermal. State production mix, not site procurement.", scope="state_proxy"))
    return rows


ACS_COLUMNS = ["NAME", "B01003_001E", "B19013_001E", "B23025_001E", "B23025_003E", "B23025_005E"]


def census_bulk_table(path, table):
    needed = {"B01003": ["B01003_E001"], "B19013": ["B19013_E001"],
              "B23025": ["B23025_E001", "B23025_E003", "B23025_E005"]}[table]
    pieces = []
    for frame in pd.read_csv(path, sep="|", dtype=str, usecols=["GEO_ID", *needed], chunksize=50000):
        selected = frame[frame.GEO_ID.str.fullmatch(r"0500000US\d{5}", na=False)].copy()
        selected["county_fips"] = selected.GEO_ID.str[-5:]
        pieces.append(selected.drop(columns="GEO_ID"))
    result = pd.concat(pieces, ignore_index=True)
    if not 3000 <= len(result) <= 3500 or result.county_fips.duplicated().any():
        raise SourceError(f"Implausible ACS county table {table}")
    return result.set_index("county_fips"), needed


def ingest_census(context, counties):
    variables = ",".join(ACS_COLUMNS)
    params = {"get": variables, "for": "county:*"}
    if os.environ.get("CENSUS_API_KEY"):
        params["key"] = os.environ["CENSUS_API_KEY"]
    url = context.config["api_url"] + "?" + urlencode(params)
    try:
        path, metadata = context.artifact("acs5-2024-counties.json", url, "json")
        payload = json.loads(path.read_text())
        if not isinstance(payload, list) or not 3000 <= len(payload) - 1 <= 3500:
            raise SourceError("ACS API response has an implausible county count")
        table = pd.DataFrame(payload[1:], columns=payload[0])
        if not set([*ACS_COLUMNS, "state", "county"]).issubset(table.columns):
            raise SourceError("ACS API response is missing requested variables")
        table["county_fips"] = (table.state + table.county).map(fips)
        table = table.set_index("county_fips")
        metadata_by_table = {key: metadata for key in context.config["tables"]}
    except (SourceError, ValueError) as error:
        context.events.append(f"ACS API unavailable ({error}); trying official bulk tables")
        frames, metadata_by_table = [], {}
        for table_id in context.config["tables"]:
            filename = f"acsdt5y2024-{table_id.lower()}.dat"
            path, metadata = context.artifact(filename, context.config["bulk_url"] + filename, "text")
            frame, _ = census_bulk_table(path, table_id)
            frames.append(frame)
            metadata_by_table[table_id] = metadata
        table = pd.concat(frames, axis=1).rename(columns={
            "B01003_E001": "B01003_001E", "B19013_E001": "B19013_001E",
            "B23025_E001": "B23025_001E", "B23025_E003": "B23025_003E", "B23025_E005": "B23025_005E",
        })
    if table.index.duplicated().any():
        raise SourceError("Duplicate ACS county rows")
    rows = []
    for county in counties.itertuples():
        if county.county_fips not in table.index:
            continue
        row = table.loc[county.county_fips]
        values = [
            ("population", number(row.B01003_001E, 0), "persons", "B01003", "B01003_001E"),
            ("median_household_income_usd", number(row.B19013_001E, 0), "USD", "B19013", "B19013_001E"),
            ("civilian_labor_force", number(row.B23025_003E, 0), "persons", "B23025", "B23025_003E"),
        ]
        labor = number(row.B23025_003E, 0)
        unemployed = number(row.B23025_005E, 0)
        rate = 100 * unemployed / labor if labor and unemployed is not None else None
        if rate is not None and not 0 <= rate <= 100:
            raise SourceError("Impossible ACS unemployment rate")
        values.append(("unemployment_rate_pct", rate, "%", "B23025", "B23025_005E / B23025_003E * 100"))
        for metric, value, unit, table_id, method in values:
            rows.append(context.metric(county.county_fips, metric, value, unit, metadata_by_table[table_id],
                f"2020-2024 ACS five-year county estimate; {method}; join state+county FIPS. Workforce context only; does not measure social acceptance."))
    return rows


FEMA_FIELDS = {
    "WFIR_RISKS": "wildfire_risk_index", "DRGT_RISKS": "drought_risk_index",
    "IFLD_RISKS": "flood_risk_index", "HRCN_RISKS": "hurricane_risk_index",
    "HWAV_RISKS": "extreme_heat_risk_index", "RISK_SCORE": "all_hazard_risk_index",
}


def ingest_fema(context, counties):
    rows = []
    frames = []
    try:
        # Cache each original API page. Validate completeness using the server count.
        count_url = context.config["api_url"] + "?" + urlencode({"where": "1=1", "returnCountOnly": "true", "f": "json"})
        count_path, _ = context.artifact("nri-2025-count.json", count_url, "json")
        expected = json.loads(count_path.read_text())["count"]
        if not 3000 <= expected <= 3500:
            raise SourceError("Implausible FEMA county count")
        for offset in range(0, expected, 1000):
            query = {"where": "1=1", "outFields": ",".join(["STCOFIPS", *FEMA_FIELDS]),
                     "returnGeometry": "false", "orderByFields": "STCOFIPS",
                     "resultOffset": offset, "resultRecordCount": 1000, "f": "json"}
            url = context.config["api_url"] + "?" + urlencode(query)
            path, metadata = context.artifact(f"nri-2025-{offset}.json", url, "json")
            data = json.loads(path.read_text())
            features = data.get("features")
            if not isinstance(features, list) or not features:
                raise SourceError("FEMA API did not return county features")
            frame = pd.DataFrame([feature["attributes"] for feature in features])
            frames.append((frame, metadata))
        if sum(len(frame) for frame, _ in frames) != expected:
            raise SourceError("FEMA pagination is incomplete")
    except (SourceError, KeyError) as error:
        context.events.append(f"FEMA API unavailable ({error}); checking local official CSV")
        path, metadata = context.manual_file((".csv", ".zip"))
        if path.suffix == ".zip":
            with zipfile.ZipFile(path) as archive:
                name = next(name for name in archive.namelist() if name.endswith(".csv") and "NRI_Table_Counties" in name)
                with archive.open(name) as handle:
                    frame = pd.read_csv(handle, dtype={"STCOFIPS": str})
        else:
            frame = pd.read_csv(path, dtype={"STCOFIPS": str})
        frames = [(frame, metadata)]
    known = set(counties.county_fips)
    for table, metadata in frames:
        if not {"STCOFIPS", *FEMA_FIELDS}.issubset(table.columns):
            raise SourceError("FEMA county export lacks required hazard columns")
        for row in table.to_dict("records"):
            county = fips(row["STCOFIPS"])
            if county not in known:
                continue
            for field, metric in FEMA_FIELDS.items():
                rows.append(context.metric(county, metric, number(row[field], 0, 100),
                    "national risk percentile (0-100)", metadata,
                    f"FEMA {field}, national relative risk percentile; exact STCOFIPS join. Includes exposure/vulnerability and is not annual event probability."))
    return rows


def area_weighted_water(counties, basins):
    if basins.crs is None:
        raise SourceError("Aqueduct geometries lack CRS")
    left = counties[["county_fips", "geometry"]].to_crs("EPSG:5070")
    right = basins[["bws_score", "bws_raw", "geometry"]].to_crs("EPSG:5070")
    right["bws_score"] = pd.to_numeric(right.bws_score, errors="raise")
    right = right[right.bws_score.between(0, 5)].copy()
    if right.empty:
        raise SourceError("Aqueduct has no valid baseline stress values")
    overlaps = gpd.overlay(left, right, how="intersection", keep_geom_type=False)
    overlaps["area"] = overlaps.geometry.area
    overlaps = overlaps[overlaps.area > 0].copy()
    overlaps["weighted_stress"] = overlaps.bws_score * overlaps.area
    # Sentinel 9999 denotes arid/low water use, not a measurable withdrawal ratio.
    valid_raw = pd.to_numeric(overlaps.bws_raw, errors="raise").between(0, 100)
    overlaps["raw_area"] = overlaps.area.where(valid_raw, 0)
    overlaps["weighted_raw"] = overlaps.bws_raw.where(valid_raw, 0) * overlaps.raw_area
    sums = overlaps.groupby("county_fips")[["area", "weighted_stress", "raw_area", "weighted_raw"]].sum()
    sums["water_stress_current"] = sums.weighted_stress / sums.area
    sums["water_withdrawal_to_supply_ratio"] = sums.weighted_raw / sums.raw_area.replace(0, float("nan"))
    county_area = left.set_index("county_fips").geometry.area
    sums["aqueduct_area_coverage_pct"] = (100 * sums.area / county_area).clip(0, 100)
    # Partial overlap may be coastal geometry differences. Insufficient coverage is missing.
    sums.loc[sums.aqueduct_area_coverage_pct < 80, ["water_stress_current", "water_withdrawal_to_supply_ratio"]] = float("nan")
    return sums


def ingest_wri_aqueduct(context, counties):
    path, metadata = configured_artifact(context, "zip")
    if path.suffix == ".gpkg":
        layers = pyogrio.list_layers(path)[:, 0]
        layer = next((value for value in layers if "baseline_annual" in value.lower()), layers[0])
        uri = str(path)
    else:
        with zipfile.ZipFile(path) as archive:
            gdbs = [name.rstrip("/") for name in archive.namelist() if name.endswith(".gdb/")]
            shapes = [name for name in archive.namelist() if name.endswith(".shp") and "baseline" in name.lower()]
        if gdbs:
            uri = f"/vsizip/{path.resolve()}/{gdbs[0]}"
            layer = "baseline_annual"
        elif shapes:
            uri, layer = f"/vsizip/{path.resolve()}/{shapes[0]}", None
        else:
            raise SourceError("Expected Aqueduct baseline annual GDB/SHP in official archive")
    basins = gpd.read_file(uri, layer=layer, bbox=(-125, 24, -66, 50),
                          columns=["bws_raw", "bws_score"], engine="pyogrio")
    if not {"bws_raw", "bws_score", "geometry"}.issubset(basins.columns) or basins.empty:
        raise SourceError("Aqueduct baseline schema is invalid")
    aggregated = area_weighted_water(counties, basins)
    rows = []
    for county, value in aggregated.iterrows():
        for metric, unit in [("water_stress_current", "Aqueduct baseline stress score (0-5)"),
                             ("water_withdrawal_to_supply_ratio", "withdrawal/supply ratio"),
                             ("aqueduct_area_coverage_pct", "% county area with valid stress data")]:
            rows.append(context.metric(county, metric, number(value[metric], 0), unit, metadata,
                "WRI Aqueduct 4.0 baseline annual, 1979-2019; area-weighted basin/county intersections in EPSG:5070. Exclude no-data scores; require >=80% valid area; raw arid sentinel excluded from ratio."))
    return rows


NOAA_STATES = [
    "AL", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "ID", "IL", "IN",
    "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
    "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
    "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "HI", "AK",
]


def ingest_noaa(context, counties):
    cached = sorted(context.raw_dir.glob(context.config["filename_prefix"] + "*"))
    cached = [path for path in cached if not path.name.endswith((".json", ".part"))]
    if cached and not context.refresh:
        path = cached[-1]
        path, metadata = context.artifact(path.name, context.config["source_page"] + path.name, "text")
    else:
        if context.offline:
            raise SourceError("NOAA county normals are not cached")
        response = context.request(context.config["source_page"])
        parser = LinkParser()
        parser.feed(response.text)
        links = sorted(link for link in parser.links if link.startswith(context.config["filename_prefix"]) and re.search(r"\d{8}$", link))
        if not links:
            raise SourceError("NOAA directory has no documented county temperature normals file")
        path, metadata = context.artifact(links[-1], urljoin(context.config["source_page"], links[-1]), "text")
    state_fips = dict(zip(counties.state_code, counties.STATEFP))
    known = set(counties.county_fips)
    rows = []
    with path.open() as handle:
        for line in handle:
            if len(line.strip()) < 95 or line[5:7] != "02" or line[7:11] != "0010":
                continue
            index = int(line[:2]) - 1
            if not 0 <= index < len(NOAA_STATES) or NOAA_STATES[index] not in state_fips:
                continue
            county = state_fips[NOAA_STATES[index]] + line[2:5]
            if county not in known:
                continue
            months = [float(line[11 + 7 * index:18 + 7 * index]) for index in range(12)]
            if any(value < -50 or value > 140 for value in months):
                raise SourceError("NOAA county temperature normal is outside physical range")
            value = (sum(months) / 12 - 32) * 5 / 9
            rows.append(context.metric(county, "annual_mean_temperature_c", value, "degrees C", metadata,
                "nClimDiv 1991-2020 period 0010; unweighted mean of 12 monthly normal temperatures, Fahrenheit to Celsius. NOAA state code mapped to Census STATEFP; county suffix exact. Cooler-climate proxy, not a cooling energy forecast."))
    if len(rows) < 2900:
        raise SourceError("NOAA county normals have insufficient matched counties")
    return rows


def ingest_eia(context, counties):
    path, metadata = configured_artifact(context, "xlsx")
    heading = pd.read_excel(path, header=None, nrows=1).iloc[0, 0]
    if "2024" not in str(heading):
        raise SourceError("EIA table year changed; update registry/parser before ingestion")
    table = pd.read_excel(path, header=2)
    if not {"State", "Industrial", "Commercial"}.issubset(table.columns):
        raise SourceError("EIA price table is missing required sectors")
    table = table.set_index("State")
    rows = []
    for county in counties.itertuples():
        if county.state_name not in table.index:
            continue
        value = number(table.loc[county.state_name, "Industrial"], 0, 100)
        rows.append(context.metric(county.county_fips, "industrial_electricity_price_cents_kwh", value, "cents/kWh", metadata,
            "EIA Table 4 state annual industrial revenue/sales average, joined by Census STATE_NAME. State proxy; not a data-center tariff or interconnection offer.", scope="state_proxy"))
    return rows


ADAPTERS = {name: globals()[f"ingest_{name}"] for name in SOURCES}


def run_source(source_id, counties, root=ROOT, offline=False, refresh=False):
    context = SourceContext(source_id, root, offline, refresh)
    path = root / f"data/processed/{source_id}.json"
    signature = {
        "adapter_sha256": sha256(Path(__file__)),
        "source_config_sha256": hashlib.sha256(json.dumps(context.config, sort_keys=True).encode()).hexdigest(),
        "county_master_sha256": sha256(root / "data/interim/counties.parquet"),
    }
    if source_id == "fcc":
        signature.update(fcc_adapter_sha256=sha256(Path(__file__).with_name("fcc.py")),
                         manual_artifacts=manual_artifact_signature(context.raw_dir))
    try:
        existing = json.loads(path.read_text()) if path.exists() else None
        if existing:
            validate_measurements(existing["measurements"], set(counties.county_fips))
    except (ValueError, KeyError) as error:
        context.events.append(f"Rejected invalid processed cache: {error}")
        existing = None
    if existing and not refresh and existing.get("processing_version") == VERSION and existing.get("input_signature") == signature:
        validate_measurements(existing["measurements"], set(counties.county_fips))
        return existing, {"status": "cached", "measurement_count": len(existing["measurements"]),
                          **({"diagnostics": existing["diagnostics"]} if existing.get("diagnostics") else {})}
    try:
        rows = ADAPTERS[source_id](context, counties)
        validate_measurements(rows, set(counties.county_fips))
        payload = {
            "source_id": source_id, "processing_version": VERSION, "processed_at": now(),
            "input_signature": signature,
            "measurements": sorted(rows, key=lambda row: (row["county_fips"], row["metric_name"])),
        }
        if hasattr(context, "diagnostics"):
            payload["diagnostics"] = context.diagnostics
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_json(path, payload)
        return payload, {"status": "available", "measurement_count": len(rows), "events": context.events,
                         **({"diagnostics": payload["diagnostics"]} if payload.get("diagnostics") else {})}
    except Exception as error:
        message = f"{type(error).__name__}: {error}"
        if existing:
            validate_measurements(existing["measurements"], set(counties.county_fips))
            return existing, {"status": "last_known_good", "error": message, "events": context.events,
                              **({"diagnostics": existing["diagnostics"]} if existing.get("diagnostics") else {})}
        return None, {"status": "missing", "error": message, "events": context.events,
                      "manual_instructions": str(context.raw_dir / "README.md")}


def cli(source_id=None):
    parser = argparse.ArgumentParser()
    if source_id is None:
        parser.add_argument("source", choices=SOURCES)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    counties = load_counties(offline=args.offline)
    payload, status = run_source(source_id or args.source, counties, offline=args.offline, refresh=args.refresh)
    print(json.dumps(status, indent=2))
    # Missing sources are reported, not fatal to the application pipeline.
    return 0


if __name__ == "__main__":
    sys.exit(cli())
