"""Integration checks against locally cached official artifacts, with no network."""

import json
import shutil
import duckdb
import pandas as pd
import pytest

from pipelines.build_feature_store import build
from pipelines.common import ROOT, SourceContext, sha256
from pipelines.features import validate_store


@pytest.fixture(scope="module")
def store():
    root = ROOT / "data/feature_store"
    manifest = json.loads((root / "manifest.json").read_text())
    assert manifest["data_mode"] == "public_data", "Run make data to build the real store"
    directory = root / manifest["store_path"]
    locations = json.loads((directory / "location_features.json").read_text())
    evidence = json.loads((directory / "evidence_store.json").read_text())
    return manifest, directory, locations, evidence


def test_public_store_has_real_county_coverage_and_no_seeded_evidence(store):
    manifest, _, locations, evidence = store
    assert len(locations) > 3000
    assert len(locations) == manifest["location_count"]
    assert len(evidence) == manifest["evidence_count"]
    validate_store(locations, evidence)
    assert all(row["data_status"] != "estimated" for row in locations)
    assert all(row["status"] != "estimated" for row in evidence)
    assert all(not row["source_url"].startswith("local://") for row in evidence)
    sources = {row["source_name"] for row in evidence if row["raw_value"] is not None}
    for source in ["EPA", "Census", "Aqueduct", "FEMA", "NOAA", "EIA", "FCC"]:
        assert any(source in name for name in sources), source


def test_carbon_metric_is_computed_from_official_egrid_workbook(store):
    _, _, locations, evidence = store
    kent = next(row for row in locations if row["county_fips"] == "26081")
    workbook = ROOT / "data/raw/egrid/egrid2023_data_rev2.xlsx"
    raw = pd.read_excel(workbook, sheet_name="ST23", header=1)
    michigan = raw[raw.PSTATABB == "MI"].iloc[0]
    assert kent["raw_metrics"]["grid_carbon_intensity_kgco2e_mwh"] == pytest.approx(float(michigan.STC2ERTA) * 0.45359237)
    item = next(row for row in evidence if row["location_id"] == "county-26081" and row["metric_name"] == "grid_carbon_intensity_kgco2e_mwh")
    assert item["raw_sha256"] == sha256(workbook)
    assert item["geographic_scope"] == "state_proxy"
    assert item["source_year"] == 2023


def test_hazard_metric_matches_actual_fema_api_cache(store):
    _, _, locations, _ = store
    kent = next(row for row in locations if row["county_fips"] == "26081")
    matched = []
    for path in (ROOT / "data/raw/fema").glob("nri-2025-*.json"):
        if path.name.endswith((".metadata.json", ".current.json")):
            continue
        for feature in json.loads(path.read_text()).get("features", []):
            row = feature["attributes"]
            if str(row["STCOFIPS"]) == "26081":
                matched.append(row)
    assert matched
    assert kent["raw_metrics"]["wildfire_risk_index"] == matched[0]["WFIR_RISKS"]
    assert kent["raw_metrics"]["drought_risk_index"] == matched[0]["DRGT_RISKS"]


def test_acs_estimate_matches_county_row_in_official_bulk_table(store):
    _, _, locations, _ = store
    kent = next(row for row in locations if row["county_fips"] == "26081")
    path = ROOT / "data/raw/census/acsdt5y2024-b01003.dat"
    for frame in pd.read_csv(path, sep="|", dtype=str, chunksize=50000):
        selected = frame[frame.GEO_ID == "0500000US26081"]
        if not selected.empty:
            assert kent["raw_metrics"]["population"] == float(selected.iloc[0].B01003_E001)
            return
    pytest.fail("Kent County is absent from official ACS table")


def test_water_normalization_is_directionally_correct_and_not_seeded(store):
    _, _, locations, evidence = store
    kent = next(row for row in locations if row["county_fips"] == "26081")
    stress = kent["raw_metrics"]["water_stress_current"]
    assert kent["category_scores"]["water"] == pytest.approx(100 - stress * 20, abs=1e-5)
    assert kent["category_scores"]["water"] != 88  # Original seed score.
    water = next(row for row in evidence if row["location_id"] == "county-26081" and row["metric_name"] == "water_stress_current")
    assert water["raw_sha256"] == sha256(ROOT / "data/raw/wri_aqueduct/aqueduct-4-0-water-risk-data.zip")
    assert "area-weighted" in water["transformation_method"]


def test_missing_sources_remain_null_and_reduce_completeness(store):
    _, _, locations, evidence = store
    assert all(row["category_scores"]["approval"] is None for row in locations)
    assert all(row["grid_readiness_score"] is None for row in locations)
    assert all(row["capacity_pressure_score"] is None for row in locations)
    assert all(row["data_completeness_score"] < 100 for row in locations)
    approval = [row for row in evidence if row["metric_name"] == "approval_readiness"]
    assert all(row["raw_value"] is None and row["normalized_value"] is None and row["status"] == "missing" for row in approval)


def test_fcc_fiber_matches_actual_official_summary_not_seeded_or_cable(store):
    manifest, _, locations, evidence = store
    diagnostics = manifest["source_summary"]["fcc"]["diagnostics"]
    path = ROOT / "data/raw/fcc" / diagnostics["raw_artifact_name"]
    if path.suffix == ".zip":
        import zipfile
        with zipfile.ZipFile(path) as archive, archive.open(diagnostics["archive_member"]) as handle:
            source = pd.read_csv(handle, dtype=str)
    else:
        source = pd.read_csv(path, dtype=str)
    county_rows = source[source.geography_type.eq("County") & source.area_data_type.eq("Total")
                         & source.biz_res.eq("B") & source.technology.eq("Fiber")].set_index("geography_id")
    digest = sha256(path)
    fcc_evidence = {row["location_id"]: row for row in evidence if row["metric_name"] == "fiber_coverage_pct"}
    matched = 0
    for county in locations:
        item = fcc_evidence[county["location_id"]]
        if county["county_fips"] not in county_rows.index:
            assert county["category_scores"]["infrastructure"] is None
            assert item["raw_value"] is None and item["status"] == "missing"
            assert "no allocation performed" in item["notes"]
            assert item["raw_sha256"] == digest
            assert item["source_as_of"] == "2025-12-31"
            continue
        raw = county_rows.loc[county["county_fips"]]
        expected = float(raw.speed_100_20) * 100
        assert county["raw_metrics"]["fiber_coverage_pct"] == pytest.approx(expected)
        assert county["category_scores"]["infrastructure"] == pytest.approx(expected, abs=1e-6)
        assert item["raw_sha256"] == digest
        assert item["source_filters"] == "County/Total/B/Fiber"
        assert item["source_as_of"] == "2025-12-31" and item["source_year"] == 2025
        assert item["source_export_date"] == "2026-09-29"
        assert item["denominator_value"] == float(raw.total_units)
        assert item["geographic_scope"] == "county_connectivity_proxy"
        matched += 1
    assert matched == diagnostics["fiber_available_count"] == 3100
    assert diagnostics["unexpected_unmatched_fips"] == []
    assert len(diagnostics["missing_master_fips"]) == 9


def test_parquet_and_duckdb_publish_same_counties_as_json(store):
    manifest, directory, locations, evidence = store
    frame = pd.read_parquet(directory / "location_features.parquet")
    assert sorted(frame.county_fips) == sorted(row["county_fips"] for row in locations)
    with duckdb.connect(str(directory / "features.duckdb"), read_only=True) as connection:
        assert connection.execute("SELECT count(*) FROM location_features").fetchone()[0] == len(locations)
        assert connection.execute("SELECT count(*) FROM evidence").fetchone()[0] == len(evidence)
    for filename, expected in manifest["artifact_checksums"].items():
        assert sha256(directory / filename) == expected


def test_offline_rebuild_reuses_real_processed_features_without_network(tmp_path, monkeypatch):
    for directory in ["config", "data/processed", "data/interim", "data/raw/fcc"]:
        shutil.copytree(ROOT / directory, tmp_path / directory)
    (tmp_path / "pipelines").mkdir()
    for name in ["features.py", "build_feature_store.py"]:
        shutil.copyfile(ROOT / "pipelines" / name, tmp_path / "pipelines" / name)
    monkeypatch.setattr(SourceContext, "request", lambda *args, **kwargs: pytest.fail("Offline build attempted network"))
    first = build(tmp_path, offline=True)
    second = build(tmp_path, offline=True)
    assert first["data_mode"] == second["data_mode"] == "public_data"
    assert first["location_count"] > 3000
    assert first["store_path"] == second["store_path"]
    assert first["artifact_checksums"] == second["artifact_checksums"]
    release = tmp_path / "data/feature_store" / second["store_path"]
    features = json.loads((release / "location_features.json").read_text())
    kent = next(row for row in features if row["county_fips"] == "26081")
    assert kent["raw_metrics"]["population"] == 663150
    assert kent["category_scores"]["water"] != 88
