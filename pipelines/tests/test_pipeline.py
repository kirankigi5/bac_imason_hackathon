import json
import shutil
from pathlib import Path

import geopandas as gpd
import pandas as pd
import pytest
from shapely.geometry import box

from pipelines.common import ROOT, VERSION, SourceContext, SourceError, atomic_json, validate_artifact, validate_measurements
from pipelines.features import normalize, validate_store
from pipelines.ingestion import ADAPTERS, SOURCES, area_weighted_water, run_source
from pipelines.build_feature_store import build, minimum_real_store


@pytest.fixture
def pipeline_root(tmp_path):
    (tmp_path / "config").mkdir()
    for name in ["data_sources.yaml", "features.yaml"]:
        shutil.copyfile(ROOT / "config" / name, tmp_path / "config" / name)
    return tmp_path


def test_download_rejects_html_error_page_even_with_http_200(pipeline_root, monkeypatch):
    context = SourceContext("egrid", pipeline_root)

    class Response:
        headers = {"Content-Type": "text/html"}
        url = context.config["source_page"]

        def close(self):
            pass

    monkeypatch.setattr(context, "request", lambda *args, **kwargs: Response())
    with pytest.raises(SourceError, match="returned HTML"):
        context.artifact("egrid.xlsx", context.config["source_page"], "xlsx")
    assert not list(context.raw_dir.glob("*.part"))
    assert not (context.raw_dir / "egrid.xlsx").exists()


def test_refresh_versions_raw_cache_and_selects_latest_without_overwrite(pipeline_root, monkeypatch):
    context = SourceContext("census", pipeline_root)
    bodies = [json.dumps({"county": "26081", "population": value}).encode() for value in [100, 200]]

    class Response:
        headers = {"Content-Type": "application/json"}
        url = context.config["api_url"]

        def iter_content(self, _size):
            yield bodies.pop(0)

        def close(self):
            pass

    monkeypatch.setattr(context, "request", lambda *args, **kwargs: Response())
    original, _ = context.artifact("counties.json", context.config["api_url"], "json")
    original_bytes = original.read_bytes()
    context.refresh = True
    updated, _ = context.artifact("counties.json", context.config["api_url"], "json")
    assert updated != original
    assert original.read_bytes() == original_bytes
    context.refresh, context.offline = False, True
    monkeypatch.setattr(context, "request", lambda *args, **kwargs: pytest.fail("Cached acquisition called network"))
    selected, _ = context.artifact("counties.json", context.config["api_url"], "json")
    assert selected == updated
    assert json.loads(selected.read_text())["population"] == 200


def test_cache_checksum_detects_mutated_raw_artifact(pipeline_root):
    context = SourceContext("census", pipeline_root, offline=True)
    path = context.raw_dir / "counties.json"
    path.write_text(json.dumps({"county": "26081", "population": 100}))
    context.artifact(path.name, None, "json")
    path.write_text(json.dumps({"county": "26081", "population": 999}))
    with pytest.raises(SourceError, match="checksum changed"):
        context.artifact(path.name, None, "json")


def test_non_zip_dataset_is_never_accepted_as_workbook(tmp_path):
    path = tmp_path / "egrid.xlsx"
    path.write_text("not a workbook " * 10)
    with pytest.raises(SourceError, match="valid ZIP"):
        validate_artifact(path, "xlsx")


def test_water_spatial_join_uses_intersection_area_not_centroid():
    counties = gpd.GeoDataFrame({"county_fips": ["26081"]}, geometry=[box(0, 0, 1000, 1000)], crs="EPSG:5070")
    basins = gpd.GeoDataFrame({"bws_score": [1.0, 5.0], "bws_raw": [0.1, 1.0]},
        geometry=[box(0, 0, 250, 1000), box(250, 0, 1000, 1000)], crs="EPSG:5070")
    result = area_weighted_water(counties, basins).loc["26081"]
    assert result.water_stress_current == pytest.approx(4.0)
    assert result.aqueduct_area_coverage_pct == pytest.approx(100)
    assert normalize(result.water_stress_current, {"min": 0, "max": 5, "direction": "lower"}) == pytest.approx(20)


def test_water_no_data_is_not_interpreted_as_low_stress():
    counties = gpd.GeoDataFrame({"county_fips": ["26081"]}, geometry=[box(0, 0, 1000, 1000)], crs="EPSG:5070")
    basins = gpd.GeoDataFrame({"bws_score": [1.0, -9999.0], "bws_raw": [0.1, -9999.0]},
        geometry=[box(0, 0, 250, 1000), box(250, 0, 1000, 1000)], crs="EPSG:5070")
    result = area_weighted_water(counties, basins).loc["26081"]
    assert result.aqueduct_area_coverage_pct == pytest.approx(25)
    assert pd.isna(result.water_stress_current)


@pytest.mark.parametrize("direction,low,high", [("higher", 0, 100), ("lower", 100, 0)])
def test_normalization_direction_and_clipping(direction, low, high):
    rule = {"min": 0, "max": 100, "direction": direction}
    assert normalize(-10, rule) == low
    assert normalize(110, rule) == high
    assert normalize(None, rule) is None


def test_failed_refresh_keeps_last_known_good_source(pipeline_root, monkeypatch):
    counties = gpd.GeoDataFrame({"county_fips": ["26081"]}, geometry=[box(0, 0, 1, 1)], crs="EPSG:4326")
    county_path = pipeline_root / "data/interim/counties.parquet"
    county_path.parent.mkdir(parents=True)
    counties.to_parquet(county_path)
    context = SourceContext("egrid", pipeline_root)
    metadata = {"source_url": context.config["source_page"], "retrieved_at": "2026-10-03T00:00:00Z", "sha256": "a" * 64}
    row = context.metric("26081", "grid_carbon_intensity_kgco2e_mwh", 300, "kg CO2e/MWh", metadata, "test state join")
    path = pipeline_root / "data/processed/egrid.json"
    payload = {"source_id": "egrid", "processing_version": VERSION, "measurements": [row]}
    atomic_json(path, payload)
    before = path.read_bytes()
    monkeypatch.setitem(ADAPTERS, "egrid", lambda *args: (_ for _ in ()).throw(SourceError("refresh schema changed")))
    result, status = run_source("egrid", counties, pipeline_root, refresh=True)
    assert result == payload
    assert status["status"] == "last_known_good"
    assert path.read_bytes() == before


def test_measurement_validation_rejects_duplicates_unmatched_fips_and_missing_provenance(pipeline_root):
    context = SourceContext("census", pipeline_root)
    metadata = {"source_url": context.config["source_page"], "retrieved_at": "2026-10-03T00:00:00Z", "sha256": "a" * 64}
    row = context.metric("26081", "population", 100, "persons", metadata, "county FIPS join")
    with pytest.raises(SourceError, match="Duplicate"):
        validate_measurements([row, row], {"26081"})
    with pytest.raises(SourceError, match="Unmatched"):
        validate_measurements([row], {"01001"})
    invalid = {**row, "source_year": None}
    with pytest.raises(SourceError, match="provenance"):
        validate_measurements([invalid], {"26081"})


def test_unavailable_source_does_not_replace_working_application_store(pipeline_root, monkeypatch):
    counties = gpd.GeoDataFrame({"county_fips": ["26081"]}, geometry=[box(0, 0, 1, 1)], crs="EPSG:4326")
    directory = pipeline_root / "data/feature_store"
    manifest = {"data_mode": "public_data", "store_path": "releases/" + "a" * 20}
    atomic_json(directory / "manifest.json", manifest)
    atomic_json(directory / "location_features.json", [{"county_fips": "26081"}])
    atomic_json(directory / "evidence_store.json", [])
    before = (directory / "manifest.json").read_bytes()
    monkeypatch.setattr("pipelines.build_feature_store.load_counties", lambda *args: counties)
    monkeypatch.setattr("pipelines.build_feature_store.run_source", lambda *args: (None, {"status": "missing"}))
    monkeypatch.setattr("pipelines.build_feature_store.engineer", lambda *args: ([], [], {}))
    assert build(pipeline_root, offline=True) == manifest
    assert (directory / "manifest.json").read_bytes() == before


def test_one_source_or_one_category_is_not_a_minimum_real_store():
    rows = [{"category_scores": {"energy": 70, "water": None}}] * 10
    payloads = {"egrid": {"measurements": [{"raw_value": 20}]}}
    assert not minimum_real_store(rows, payloads)


def test_manual_fallback_instructions_exist_for_every_source():
    for source in [*SOURCES, "counties"]:
        readme = ROOT / "data/raw" / source / "README.md"
        assert readme.is_file(), source
        text = readme.read_text()
        assert "https://" in text and "command" in text.lower()
