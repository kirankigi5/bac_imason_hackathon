#!/usr/bin/env python3
"""Acquire official sources and atomically publish a county feature/evidence store."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

# Support both the documented direct script and python -m invocation.
if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import duckdb
import pandas as pd

from pipelines.common import ROOT, VERSION, SourceError, atomic_json, now, sha256
from pipelines.features import CATEGORIES, engineer
from pipelines.ingestion import SOURCES, load_counties, run_source


def minimum_real_store(locations, payloads):
    sources = {source for source, payload in payloads.items()
               if any(row["raw_value"] is not None for row in payload["measurements"])}
    supported = [row for row in locations if sum(score is not None for score in row["category_scores"].values()) >= 2]
    return len(sources) >= 2 and len(supported) >= 10


def publish(root, locations, evidence, manifest, fingerprint):
    directory = root / "data/feature_store"
    release = directory / "releases" / fingerprint
    if not release.exists():
        staging = release.with_name(f"{fingerprint}.{os.getpid()}.tmp")
        staging.mkdir(parents=True, exist_ok=True)
        try:
            atomic_json(staging / "location_features.json", locations)
            atomic_json(staging / "evidence_store.json", evidence)
            grouped = {}
            for item in evidence:
                grouped.setdefault(item["location_id"], []).append(item)
            for location_id, items in grouped.items():
                atomic_json(staging / "evidence" / (location_id + ".json"), items)
            pd.DataFrame(locations).to_parquet(staging / "location_features.parquet", index=False)
            pd.DataFrame(evidence).to_parquet(staging / "evidence.parquet", index=False)
            with duckdb.connect(str(staging / "features.duckdb")) as database:
                database.execute("CREATE TABLE location_features AS SELECT * FROM read_parquet(?)",
                                 [str(staging / "location_features.parquet")])
                database.execute("CREATE TABLE evidence AS SELECT * FROM read_parquet(?)",
                                 [str(staging / "evidence.parquet")])
            manifest = {
                **manifest, "built_at": now(), "store_path": f"releases/{fingerprint}",
                "partitioned_evidence": True,
                "artifact_checksums": {name: sha256(staging / name) for name in
                    ("location_features.json", "evidence_store.json", "location_features.parquet", "evidence.parquet")},
            }
            atomic_json(staging / "manifest.json", manifest)
            os.replace(staging, release)
        finally:
            if staging.exists():
                shutil.rmtree(staging)
    # A single pointer commits the full validated bundle. The app reads only its
    # selected release, so feature/evidence files never belong to different builds.
    manifest = json.loads((release / "manifest.json").read_text())
    atomic_json(directory / "manifest.json", manifest)
    # Compatibility exports for tools consuming the original flat file locations.
    for name in ("location_features.json", "evidence_store.json", "location_features.parquet", "evidence.parquet", "features.duckdb"):
        temp = directory / (name + ".tmp")
        shutil.copyfile(release / name, temp)
        os.replace(temp, directory / name)
    return manifest


def build(root=ROOT, *, offline=False, refresh=False, sources=SOURCES):
    statuses, payloads = {}, {}
    directory = root / "data/feature_store"
    try:
        counties = load_counties(root, offline, refresh)
        for source in sources:
            payload, status = run_source(source, counties, root, offline, refresh)
            statuses[source] = status
            print(f"{source:16} {status['status'].upper()}", flush=True)
            for event in status.get("events", []):
                print(f"  {event}", flush=True)
            if status.get("error"):
                print(f"  {status['error']}", flush=True)
            if payload is not None:
                payloads[source] = payload
        locations, evidence, normalization = engineer(counties, payloads, statuses, root)
        if not minimum_real_store(locations, payloads):
            raise SourceError("Minimum real store requires 10 counties with at least 2 categories from 2 official sources")
        inputs = {
            "processing_version": VERSION, "rules_sha256": sha256(root / "config/features.yaml"),
            "pipeline_sha256": {name: sha256(root / "pipelines" / name) for name in
                               ("features.py", "build_feature_store.py")},
            "registry_sha256": sha256(root / "config/data_sources.yaml"),
            "counties_sha256": sha256(root / "data/interim/counties.parquet"),
            "sources": {source: sha256(root / f"data/processed/{source}.json") for source in payloads},
            "stale_sources": sorted(source for source, status in statuses.items() if status["status"] == "last_known_good"),
        }
        fingerprint = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()[:20]
        manifest = {
            "processing_version": VERSION, "data_mode": "public_data",
            "location_count": len(locations), "evidence_count": len(evidence),
            "geographic_scope": "Contiguous U.S. states and DC; 2024 county geography",
            "data_completeness_average": round(sum(row["data_completeness_score"] for row in locations) / len(locations), 1),
            "source_summary": statuses, "input_checksums": inputs, "normalization": normalization,
            "category_coverage": {category: sum(row["category_scores"][category] is not None for row in locations) for category in CATEGORIES},
            "limitations": [
                "eGRID and EIA are state averages mapped to counties, not utility-specific supply/tariffs.",
                "Historical baseline indicators are not future projections.",
                "ACS workforce is a community/economic context proxy, not social acceptance.",
                "Grid capacity, parcel suitability, local approval and market pressure are unavailable.",
                "FCC unit-weighted mass-market availability is not data-center fiber capacity or route diversity; legacy Connecticut counties are not allocated to current planning regions.",
            ],
        }
        manifest = publish(root, locations, evidence, manifest, fingerprint)
        print(f"Feature store: PUBLIC DATA, {manifest['location_count']} counties, {manifest['evidence_count']} evidence rows")
        print(f"Data completeness: {manifest['data_completeness_average']}%")
        return manifest
    except (SourceError, OSError, ValueError) as error:
        print(f"Real store unavailable: {error}", file=sys.stderr)
        existing = directory / "manifest.json"
        if existing.exists() and (directory / "location_features.json").exists() and (directory / "evidence_store.json").exists():
            manifest = json.loads(existing.read_text())
            print(f"Preserving last valid feature store ({manifest['data_mode']})", file=sys.stderr)
            return manifest
        return build_demo(root)


def build_demo(root=ROOT):
    seed_path = root / "data/seeds/seed_location_features.json"
    if not seed_path.exists():
        raise SourceError("No valid processed/cached/seeded feature store is available")
    seeds = json.loads(seed_path.read_text())
    if len(seeds) < 10 or len({row["county_fips"] for row in seeds}) != len(seeds):
        raise SourceError("Seed fallback is invalid")
    locations, evidence = [], []
    timestamp = now()
    for row in seeds:
        provenance = {
            "source_name": "Seeded demo feature store", "source_url": "local://data/seeds/seed_location_features.json",
            "source_year": 2026, "retrieved_at": timestamp, "confidence": "demo-estimate",
            "raw_unit": "demo proxy", "transformation_method": "Manual seed; no public measurements",
        }
        locations.append({**row, "lat": row["centroid_lat"], "lon": row["centroid_lon"],
                          "data_completeness_score": 100, "last_updated": timestamp,
                          "processing_version": "seed-feature-store-v1", "provenance": provenance})
        for category, value in row["category_scores"].items():
            if not isinstance(value, (int, float)) or not 0 <= value <= 100:
                raise SourceError("Invalid demo fallback score")
            evidence.append({**provenance, "location_id": row["location_id"], "metric_name": category + "_score",
                             "raw_value": value, "normalized_value": value, "unit": "demo score",
                             "status": "estimated", "notes": "Seed fallback only", "processing_version": "seed-feature-store-v1"})
    directory = root / "data/feature_store"
    atomic_json(directory / "location_features.json", locations)
    atomic_json(directory / "evidence_store.json", evidence)
    manifest = {"data_mode": "seeded_demo", "location_count": len(locations), "evidence_count": len(evidence),
                "built_at": timestamp, "processing_version": "seed-feature-store-v1", "data_completeness_average": 100}
    atomic_json(directory / "manifest.json", manifest)
    print("USING EXPLICITLY LABELED SEEDED DEMO FALLBACK")
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="Use only local raw/processed caches")
    parser.add_argument("--refresh", action="store_true", help="Acquire immutable new raw versions; preserve last-known-good on failure")
    parser.add_argument("--sources", nargs="+", choices=SOURCES, default=list(SOURCES))
    args = parser.parse_args()
    build(offline=args.offline, refresh=args.refresh, sources=args.sources)


if __name__ == "__main__":
    main()
