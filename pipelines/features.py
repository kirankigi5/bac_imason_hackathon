"""Feature engineering, documented normalization and provenance-preserving joins."""

from __future__ import annotations

import math

import pandas as pd
import yaml

from pipelines.common import ROOT, VERSION, SourceError
from pipelines.fcc import PROVENANCE_DETAILS

CATEGORIES = ("energy", "water", "climate", "infrastructure", "economics", "approval", "community")


def feature_rules(root=ROOT):
    with (root / "config/features.yaml").open() as handle:
        return yaml.safe_load(handle)["metrics"]


def normalize(value, rule, bounds=None):
    if value is None:
        return None
    if not math.isfinite(value):
        raise SourceError("Non-finite feature")
    if rule.get("method") == "log_percentile":
        if value < 0:
            raise SourceError("Negative workforce count")
        value = math.log1p(value)
        low, high = bounds
    else:
        low, high = rule["min"], rule["max"]
    fraction = 0.5 if high == low else max(0, min(1, (value - low) / (high - low)))
    return round(100 * (1 - fraction if rule["direction"] == "lower" else fraction), 6)


def engineer(counties, source_payloads, source_status, root=ROOT):
    rules = feature_rules(root)
    measurements = {}
    for source_id, payload in source_payloads.items():
        for row in payload["measurements"]:
            key = (row["county_fips"], row["metric_name"])
            if key in measurements:
                raise SourceError(f"Multiple sources own the same metric: {key}")
            measurements[key] = {**row, "source_id": source_id,
                "status": "stale" if source_status[source_id]["status"] == "last_known_good" and row["raw_value"] is not None else row["status"]}
    bounds = {}
    for metric, rule in rules.items():
        if rule.get("method") == "log_percentile":
            values = [math.log1p(row["raw_value"]) for (_, name), row in measurements.items()
                      if name == metric and row["raw_value"] is not None]
            if values:
                series = pd.Series(values)
                bounds[metric] = (float(series.quantile(rule["lower_percentile"])), float(series.quantile(rule["upper_percentile"])))
    locations, evidence = [], []
    metric_by_county = {}
    for (county, metric), row in measurements.items():
        metric_by_county.setdefault(county, {})[metric] = row
    for county in counties.itertuples():
        county_id = county.county_fips
        location_id = f"county-{county_id}"
        raw = metric_by_county.get(county_id, {})
        normalized, category_metrics, contributors, category_coverage = {}, {}, {}, {}
        for metric, rule in rules.items():
            row = raw.get(metric)
            value = row["raw_value"] if row else None
            score = normalize(value, rule, bounds.get(metric)) if value is not None else None
            normalized[metric] = score
            if row is None:
                row = {
                    "metric_name": metric, "raw_value": None, "raw_unit": rule["unit"],
                    "source_name": rule["source"], "source_url": "", "source_year": None,
                    "retrieved_at": None, "raw_sha256": None, "geographic_scope": "unavailable",
                    "status": "missing", "transformation_method": "Unavailable; excluded without zero imputation",
                }
            method = f"clipped linear [{rule.get('min')}, {rule.get('max')}]; {rule['direction']} is better"
            if rule.get("method") == "log_percentile":
                method = f"log1p; population-wide p5/p95 bounds {bounds.get(metric)}; higher is better"
            item = {
                "location_id": location_id, **{key: row.get(key) for key in [
                    "metric_name", "source_name", "source_url", "source_year", "retrieved_at",
                    "raw_sha256", "geographic_scope", "status", "transformation_method"]},
                **{key: row[key] for key in PROVENANCE_DETAILS if key in row},
                "raw_value": value, "normalized_value": score, "unit": row["raw_unit"],
                "raw_unit": row["raw_unit"], "normalization_method": method,
                "confidence": "missing" if value is None else "official_source_planning_proxy",
                "processing_version": VERSION, "notes": row["transformation_method"],
            }
            evidence.append(item)
            category_metrics.setdefault(rule["category"], []).append((score, rule["weight"], item))
        # Context metrics remain raw evidence even when they are not used in ranking.
        for metric, row in raw.items():
            if metric not in rules:
                evidence.append({
                    "location_id": location_id, **row, "normalized_value": None,
                    "unit": row["raw_unit"], "confidence": "official_source",
                    "notes": row["transformation_method"],
                })
        scores = {}
        for category in CATEGORIES:
            all_items = category_metrics.get(category, [])
            items = [item for item in all_items if item[0] is not None]
            weight = sum(item[1] for item in items)
            scores[category] = round(sum(score * w for score, w, _ in items) / weight, 6) if weight else None
            category_coverage[category] = round(100 * weight / sum(item[1] for item in all_items), 1) if all_items else 0
            contributors[category] = [{key: item[key] for key in ("metric_name", "source_name", "source_year", "raw_sha256")}
                                      for _, _, item in items]
        measured = sum(value is not None for value in normalized.values())
        notes = [
            "Official historical data; county/state/basin planning proxies, not parcel feasibility.",
            "Community score uses ACS labor-pool context only; no community acceptance or local approval is inferred.",
            "Power capacity, interconnection readiness, land availability and market pressure are unavailable.",
        ]
        if raw.get("fiber_coverage_pct", {}).get("raw_value") is not None:
            notes.append("FCC fiber is county-unit mass-market business availability at 100/20 Mbps, not data-center backbone capacity or route diversity.")
        missing_categories = [category for category in CATEGORIES if scores[category] is None]
        notes.append("Unavailable categories excluded from weights: " + ", ".join(missing_categories))
        locations.append({
            "location_id": location_id, "county_fips": county_id,
            "county_name": county.county_name, "state_code": county.state_code, "state_name": county.state_name,
            "nearby_metro": county.county_name, "centroid_lat": county.lat, "centroid_lon": county.lon,
            "lat": county.lat, "lon": county.lon, "category_scores": scores,
            "category_coverage": category_coverage, "raw_metrics": {key: row["raw_value"] for key, row in raw.items()},
            "normalized_metrics": normalized, "grid_readiness_score": None,
            "power_readiness_label": "unknown; utility validation required", "capacity_pressure_score": None,
            "data_status": ("stale" if any(row["status"] == "stale" for row in raw.values()) else "available") if measured else "missing",
            "data_completeness_score": round(100 * measured / len(rules), 1),
            "missing_metrics": [name for name, score in normalized.items() if score is None],
            "notes": " ".join(notes), "last_updated": max((row["retrieved_at"] for row in raw.values()), default=""),
            "processing_version": VERSION,
            "provenance": {
                "source_name": "Official county feature pipeline", "source_url": "config/data_sources.yaml",
                "source_year": max((row["source_year"] for row in raw.values()), default=None),
                "retrieved_at": max((row["retrieved_at"] for row in raw.values()), default=""),
                "confidence": "coverage_dependent", "raw_unit": "source-specific",
                "transformation_method": "config/features.yaml; weighted available metric scores, missing values excluded",
                "sources": sorted({row["source_name"] for row in raw.values()}),
            },
            "category_provenance": contributors,
        })
    validate_store(locations, evidence)
    return locations, evidence, {"rules": rules, "percentile_bounds": bounds}


def validate_store(locations, evidence):
    ids = [row["county_fips"] for row in locations]
    if len(ids) != len(set(ids)):
        raise SourceError("Duplicate feature-store county FIPS")
    for row in locations:
        for score in row["category_scores"].values():
            if score is not None and (not math.isfinite(score) or not 0 <= score <= 100):
                raise SourceError("Invalid normalized category score")
        if not -90 <= row["lat"] <= 90 or not -180 <= row["lon"] <= 180:
            raise SourceError("Invalid feature-store centroid")
    for row in evidence:
        if row["raw_value"] is not None:
            for field in ("source_name", "source_url", "source_year", "retrieved_at", "processing_version", "raw_unit", "transformation_method", "raw_sha256"):
                if not row.get(field):
                    raise SourceError(f"Evidence has incomplete provenance: {field}")
