"""FCC's technology-specific, unit-weighted county availability summary."""

from __future__ import annotations

import hashlib
import json
import re
import zipfile
from datetime import datetime
from pathlib import Path

import pandas as pd

from pipelines.common import SourceError, fips, number, sha256, validate_artifact

SUMMARY_PATTERN = re.compile(
    r"bdc_us_fixed_broadband_summary_by_geography_([JD])(\d{2})_(\d{1,2}[a-z]{3}\d{4})\.csv",
    re.IGNORECASE,
)
SPEEDS = ("speed_02_02", "speed_10_1", "speed_25_3", "speed_100_20", "speed_250_25", "speed_1000_100")
REQUIRED_COLUMNS = {"area_data_type", "geography_type", "geography_id", "total_units", "biz_res", "technology", *SPEEDS}
EXCLUDED_STATES = {"02", "15", "60", "66", "69", "72", "78"}
FORMER_CT_COUNTIES = {f"09{suffix:03}" for suffix in range(1, 16, 2)}
EXPORT_REQUIRED = (
    "Download National Broadband Map > Data Download > Summary Data > Fixed Broadband "
    "Summary by Geography, including County, Total, biz_res=B, technology=Fiber, "
    "total_units and speed_100_20, for the configured as-of date. An Any Technology, "
    "Cable/Fiber or speed-only export cannot establish fiber availability. "
    "Keep the original FCC ZIP in data/raw/fcc/."
)
PROVENANCE_DETAILS = (
    "source_as_of", "source_export_date", "source_vintage_basis", "raw_artifact_name",
    "raw_artifact_kind", "archive_member", "archive_member_sha256", "source_column",
    "source_filters", "denominator_name", "denominator_value",
)


def manual_artifact_signature(raw_dir):
    return {path.name: sha256(path) for path in sorted(raw_dir.iterdir())
            if path.suffix.lower() in {".zip", ".csv"}}


def read_summary(context):
    archives = sorted(context.raw_dir.glob("*.zip"))
    exports = archives or sorted(context.raw_dir.glob("*.csv"))
    if len(exports) != 1:
        raise SourceError("Select exactly one FCC release (ZIP preferred). " + EXPORT_REQUIRED)
    path = exports[0]
    validate_artifact(path, path.suffix.lstrip("."))
    sidecar = path.with_suffix(path.suffix + ".metadata.json")
    metadata = json.loads(sidecar.read_text()) if sidecar.exists() else context.local_metadata(path, None)
    if sha256(path) != metadata["sha256"]:
        raise SourceError("FCC immutable raw artifact checksum changed")
    details = {"raw_artifact_name": path.name, "raw_artifact_kind": path.suffix.lstrip(".")}
    if archives:
        # Read in-place; never extract into or rewrite the original archive.
        with zipfile.ZipFile(path) as archive:
            members = [item for item in archive.namelist() if SUMMARY_PATTERN.fullmatch(Path(item).name)]
            if len(members) != 1:
                raise SourceError("FCC ZIP must contain one identifiable geography summary CSV. " + EXPORT_REQUIRED)
            filename = Path(members[0]).name
            digest = hashlib.sha256()
            with archive.open(members[0]) as handle:
                for block in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(block)
            details.update(archive_member=members[0], archive_member_sha256=digest.hexdigest())
            with archive.open(members[0]) as handle:
                table = pd.read_csv(handle, dtype=str, encoding="utf-8-sig")
    else:
        filename = path.name
        table = pd.read_csv(path, dtype=str, encoding="utf-8-sig")
        context.events.append("Original ZIP absent; using unchanged raw CSV, explicitly recorded as CSV (not ZIP provenance)")
    match = SUMMARY_PATTERN.fullmatch(filename)
    if not match:
        raise SourceError("FCC filename does not identify its vintage. " + EXPORT_REQUIRED)
    year = 2000 + int(match[2])
    as_of = f"{year}-{'06-30' if match[1].upper() == 'J' else '12-31'}"
    try:
        export_date = datetime.strptime(match[3].lower(), "%d%b%Y").date().isoformat()
    except ValueError as error:
        raise SourceError("Invalid FCC export date in filename") from error
    if as_of != context.config["source_as_of"] or year != context.config["source_year"] or export_date < as_of:
        raise SourceError("FCC export vintage does not match the configured as-of date")
    details.update(source_as_of=as_of, source_export_date=export_date,
                   source_vintage_basis="FCC summary filename J/D semiannual token and export date; dates not embedded in CSV")
    context.diagnostics = {**details, "raw_sha256": metadata["sha256"], "schema": list(table.columns),
                           "input_row_count": len(table), "original_zip_present": bool(archives)}
    context.events.append(f"FCC schema inspected: {len(table)} rows, {len(table.columns)} columns; as-of {as_of}, export {export_date}")
    return table, metadata, details


def ingest_fcc(context, counties):
    if not any(path.suffix.lower() in {".csv", ".zip"} for path in context.raw_dir.iterdir()) and not context.offline:
        try:
            response = context.request(context.config["source_page"])
            context.events.append(f"FCC portal HTTP {response.status_code}; manual export required; no undocumented API used")
            response.close()
        except SourceError as error:
            context.events.append(f"FCC portal unavailable: {error}")
    table, metadata, details = read_summary(context)
    if not REQUIRED_COLUMNS.issubset(table.columns):
        raise SourceError("Unsupported FCC schema; missing " + ", ".join(sorted(REQUIRED_COLUMNS - set(table.columns))) + ". " + EXPORT_REQUIRED)
    selected = table[table.geography_type.eq("County") & table.area_data_type.eq("Total")].copy()
    if selected.empty or selected[selected.technology.eq("Fiber") & selected.biz_res.eq("B")].empty:
        raise SourceError("FCC summary lacks technology-specific business Fiber county rows. " + EXPORT_REQUIRED)
    selected["county_fips"] = selected.geography_id.map(fips)
    if selected.duplicated(["county_fips", "biz_res", "technology"]).any():
        raise SourceError("Duplicate FCC county/service/technology rows; coverage must never be summed")
    if not selected.biz_res.isin(["B", "R"]).all():
        raise SourceError("Unknown FCC business/residential filter")
    known = set(counties.county_fips)
    ids = set(selected.county_fips)
    excluded = {county for county in ids - known if county[:2] in EXCLUDED_STATES}
    legacy = (ids - known) & FORMER_CT_COUNTIES
    unexpected = ids - known - excluded - legacy
    if unexpected:
        raise SourceError("Unexpected unmatched FCC county FIPS: " + ", ".join(sorted(unexpected)))
    selected["total_units"] = selected.total_units.map(lambda value: number(value, 0))
    if selected.total_units.dropna().map(lambda value: not value.is_integer()).any():
        raise SourceError("FCC total_units must be an integer count")
    if selected.groupby("county_fips").total_units.nunique().gt(1).any():
        raise SourceError("FCC county denominators disagree across technology/service rows")
    for speed in SPEEDS:
        selected[speed] = selected[speed].map(lambda value: number(value, 0, 1))
    for lower, higher in zip(SPEEDS, SPEEDS[1:]):
        if (selected[higher] > selected[lower] + 1e-9).any():
            raise SourceError("FCC speed-tier coverage increases with a higher speed threshold")
    rows = []
    definition = (
        "FCC preaggregated County/Total served-unit fraction * 100; unit-weighted, not a count of BSL buildings. "
        "Business (B) and residential (R) service filters are separate and never added; total_units is the "
        "exported county denominator, not a business-only unit count. Exact five-digit FIPS join; no legacy "
        "Connecticut-to-planning-region allocation. Mass-market connectivity planning proxy, not dedicated "
        "data-center fiber, route diversity, backbone capacity, SLA, latency or available MW."
    )
    metrics = (
        ("fiber_coverage_pct", "B", "Fiber", "speed_100_20"),
        ("fiber_business_gigabit_coverage_pct", "B", "Fiber", "speed_1000_100"),
        ("fiber_residential_100_20_coverage_pct", "R", "Fiber", "speed_100_20"),
        ("fixed_terrestrial_business_100_20_coverage_pct", "B", "Any Terrestrial", "speed_100_20"),
    )
    for county, group in selected[selected.county_fips.isin(known)].groupby("county_fips"):
        indexed = group.set_index(["biz_res", "technology"])
        totals = group.total_units.dropna()
        total = float(totals.iloc[0]) if not totals.empty else None
        for name, service, technology, column in metrics:
            item = indexed.loc[(service, technology)] if (service, technology) in indexed.index else None
            denominator = number(item.total_units, 0) if item is not None else None
            fraction = number(item[column], 0, 1) if item is not None else None
            value = fraction * 100 if fraction is not None and denominator and denominator > 0 else None
            speed = column.removeprefix("speed_").replace("_", "/")
            method = f"technology={technology}; biz_res={service}; {column} (at least {speed} Mbps down/up). " + definition
            if value is None:
                method += " Missing selected row/value or missing/zero denominator; not imputed as zero."
            row = context.metric(county, name, value, "% FCC county units", metadata, method, scope="county_connectivity_proxy")
            row.update(details, source_column=column, source_filters=f"County/Total/{service}/{technology}",
                       denominator_name="total_units", denominator_value=denominator)
            rows.append(row)
        row = context.metric(county, "broadband_total_units", total, "FCC county units", metadata,
                             "One county Total denominator; identical across technology/service rows, never summed. Units differ from BSL building counts.")
        row.update(details, source_column="total_units", source_filters="County/Total")
        rows.append(row)
    for county in sorted(known - ids):
        reason = "No exact county FIPS match in this FCC export; missing, not zero."
        if county.startswith("09"):
            reason += " Current Connecticut planning regions cannot be joined to the eight former counties without a defensible crosswalk; no allocation performed."
        row = context.metric(county, "fiber_coverage_pct", None, "% FCC county units", metadata,
                             reason, scope="county_connectivity_proxy")
        row.update(details, source_column="speed_100_20", source_filters="County/Total/B/Fiber",
                   denominator_name="total_units", denominator_value=None)
        rows.append(row)
    context.diagnostics.update(
        county_count_in_export=len(ids), matched_county_count=len(ids & known),
        excluded_out_of_scope_fips=sorted(excluded), legacy_connecticut_fips=sorted(legacy),
        missing_master_fips=sorted(known - ids), unexpected_unmatched_fips=[],
        fiber_available_count=sum(row["metric_name"] == "fiber_coverage_pct" and row["raw_value"] is not None for row in rows),
        scored_metric="fiber_coverage_pct", scored_definition="100 * speed_100_20, County/Total/B/Fiber; positive total_units required",
    )
    context.events.append(f"FCC FIPS audit: {len(ids & known)} matched, {len(known - ids)} missing, {len(excluded)} outside scope, {len(legacy)} former CT counties; zero unexplained joins")
    return rows
