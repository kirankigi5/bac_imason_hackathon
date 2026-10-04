import hashlib
import json
import shutil
import zipfile

import pandas as pd
import pytest

from pipelines.common import ROOT, SourceContext, SourceError, sha256, validate_measurements
from pipelines.fcc import SPEEDS, ingest_fcc
from pipelines.ingestion import run_source

FILENAME = "bdc_us_fixed_broadband_summary_by_geography_D25_29sep2026.csv"


@pytest.fixture
def fcc_root(tmp_path):
    (tmp_path / "config").mkdir()
    shutil.copyfile(ROOT / "config/data_sources.yaml", tmp_path / "config/data_sources.yaml")
    return tmp_path


def summary_rows():
    return [{"area_data_type": "Total", "geography_type": "County", "geography_id": "01001",
             "geography_desc": "Autauga County", "geography_desc_full": "Autauga County, AL",
             "total_units": 100, "biz_res": service, "technology": technology,
             **{column: fraction for column in SPEEDS}}
            for service, technology, fraction in [("B", "Fiber", .5), ("R", "Fiber", .4),
                                                   ("B", "Any Terrestrial", .9), ("B", "Cable/Fiber", .95)]]


def write_summary(context, rows):
    path = context.raw_dir / FILENAME
    pd.DataFrame(rows).to_csv(path, index=False)
    return path


def master(*ids):
    return pd.DataFrame({"county_fips": list(ids or ["01001"])})


def fiber(rows):
    return next(row for row in rows if row["metric_name"] == "fiber_coverage_pct")


def test_exact_technology_service_speed_and_units_are_not_combined(fcc_root):
    context = SourceContext("fcc", fcc_root, offline=True)
    source = summary_rows()
    source.extend([{**source[0], "area_data_type": "Rural", **{column: .99 for column in SPEEDS}},
                   {**source[0], "geography_type": "State", "geography_id": "01"}])
    path = write_summary(context, source)
    digest = sha256(path)
    rows = ingest_fcc(context, master())
    validate_measurements(rows, {"01001"})
    assert fiber(rows)["raw_value"] == 50
    assert fiber(rows)["county_fips"] == "01001"
    assert fiber(rows)["denominator_value"] == 100
    assert fiber(rows)["source_filters"] == "County/Total/B/Fiber"
    assert fiber(rows)["source_as_of"] == "2025-12-31"
    assert fiber(rows)["source_export_date"] == "2026-09-29"
    assert fiber(rows)["source_year"] == 2025
    assert fiber(rows)["raw_artifact_kind"] == "csv"
    assert fiber(rows)["raw_sha256"] == digest == sha256(path)
    assert {row["metric_name"]: row["raw_value"] for row in rows}["fiber_residential_100_20_coverage_pct"] == 40
    assert context.diagnostics["original_zip_present"] is False


def test_zip_is_immutable_and_preferred_over_unverified_extracted_csv(fcc_root):
    context = SourceContext("fcc", fcc_root, offline=True)
    text = pd.DataFrame(summary_rows()).to_csv(index=False)
    archive_path = context.raw_dir / "original-fcc.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("export/" + FILENAME, text)
    write_summary(context, [{**row, **{column: .99 for column in SPEEDS}} for row in summary_rows()])
    before = archive_path.read_bytes()
    rows = ingest_fcc(context, master())
    assert fiber(rows)["raw_value"] == 50
    assert fiber(rows)["raw_sha256"] == sha256(archive_path)
    assert fiber(rows)["raw_artifact_kind"] == "zip"
    assert fiber(rows)["archive_member"] == "export/" + FILENAME
    assert fiber(rows)["archive_member_sha256"] == hashlib.sha256(text.encode()).hexdigest()
    assert archive_path.read_bytes() == before


@pytest.mark.parametrize("value,total,expected", [(None, 100, None), ("-999", 100, None),
                                                 (.5, None, None), (0, 0, None), (0, 100, 0)])
def test_missing_or_zero_denominator_is_not_zero_imputed(fcc_root, value, total, expected):
    context = SourceContext("fcc", fcc_root, offline=True)
    source = summary_rows()
    for row in source:
        row["total_units"] = total
    source[0]["speed_100_20"] = value
    if value == 0:
        source[0].update(speed_250_25=0, speed_1000_100=0)
    write_summary(context, source)
    result = fiber(ingest_fcc(context, master()))
    assert result["raw_value"] == expected
    assert result["status"] == ("missing" if expected is None else "available")


def test_no_fiber_rows_requires_specific_export_not_inference_from_speed(fcc_root):
    context = SourceContext("fcc", fcc_root, offline=True)
    write_summary(context, [row for row in summary_rows() if row["technology"] != "Fiber"])
    with pytest.raises(SourceError, match="Summary by Geography.*technology=Fiber"):
        ingest_fcc(context, master())


@pytest.mark.parametrize("failure", ["duplicate", "invalid_fips", "unknown_fips", "fraction", "denominator", "units", "speeds"])
def test_invalid_schema_values_and_joins_are_rejected(fcc_root, failure):
    context = SourceContext("fcc", fcc_root, offline=True)
    rows = summary_rows()
    if failure == "duplicate":
        rows.append(rows[0].copy())
    elif failure == "invalid_fips":
        rows[0]["geography_id"] = "AL001"
    elif failure == "unknown_fips":
        rows[0]["geography_id"] = "01999"
    elif failure == "fraction":
        rows[0]["speed_100_20"] = 1.01
    elif failure == "denominator":
        rows[0]["total_units"] = 99
    elif failure == "units":
        for row in rows:
            row["total_units"] = 100.5
    else:
        rows[0]["speed_1000_100"] = .9
    write_summary(context, rows)
    with pytest.raises(SourceError):
        ingest_fcc(context, master())


def test_legacy_connecticut_and_scope_exclusions_have_explicit_join_audit(fcc_root):
    context = SourceContext("fcc", fcc_root, offline=True)
    rows = summary_rows()
    rows += [{**rows[0], "geography_id": county} for county in ["09001", "02013"]]
    write_summary(context, rows)
    output = ingest_fcc(context, master("01001", "09110"))
    assert {row["county_fips"] for row in output} == {"01001", "09110"}
    absent = next(row for row in output if row["county_fips"] == "09110")
    assert absent["raw_value"] is None and absent["status"] == "missing"
    assert "no allocation performed" in absent["transformation_method"]
    assert absent["source_as_of"] == "2025-12-31"
    assert context.diagnostics["missing_master_fips"] == ["09110"]
    assert context.diagnostics["legacy_connecticut_fips"] == ["09001"]
    assert context.diagnostics["excluded_out_of_scope_fips"] == ["02013"]


def test_filename_vintage_must_match_configured_release(fcc_root):
    context = SourceContext("fcc", fcc_root, offline=True)
    path = write_summary(context, summary_rows())
    path.rename(path.with_name(FILENAME.replace("D25", "J25")))
    with pytest.raises(SourceError, match="vintage"):
        ingest_fcc(context, master())


def test_adding_manual_artifact_invalidates_cache_and_mutation_retains_last_good(fcc_root):
    counties = master()
    interim = fcc_root / "data/interim"
    interim.mkdir(parents=True)
    counties.to_parquet(interim / "counties.parquet")
    empty, status = run_source("fcc", counties, fcc_root, offline=True)
    assert empty is None and status["status"] == "missing"
    context = SourceContext("fcc", fcc_root, offline=True)
    path = write_summary(context, summary_rows())
    payload, status = run_source("fcc", counties, fcc_root, offline=True)
    assert status["status"] == "available"
    assert run_source("fcc", counties, fcc_root, offline=True)[1]["status"] == "cached"
    path.write_text(path.read_text() + "\n")
    retained, status = run_source("fcc", counties, fcc_root, offline=True)
    assert status["status"] == "last_known_good"
    assert "checksum changed" in status["error"]
    assert retained == payload
    assert json.loads((fcc_root / "data/processed/fcc.json").read_text()) == payload


def test_missing_selected_business_fiber_row_remains_null(fcc_root):
    context = SourceContext("fcc", fcc_root, offline=True)
    rows = summary_rows()
    rows += [{**row, "geography_id": "01003"} for row in rows if not (row["technology"] == "Fiber" and row["biz_res"] == "B")]
    write_summary(context, rows)
    output = ingest_fcc(context, master("01001", "01003"))
    absent = next(row for row in output if row["county_fips"] == "01003" and row["metric_name"] == "fiber_coverage_pct")
    assert absent["raw_value"] is None and absent["status"] == "missing"
