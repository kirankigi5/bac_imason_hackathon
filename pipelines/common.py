"""Shared source acquisition, validation and immutable cache handling."""

from __future__ import annotations

import hashlib
import json
import math
import os
import time
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import pandas as pd
import requests
import yaml

ROOT = Path(__file__).resolve().parents[1]
VERSION = "public-county-v1"
PROVENANCE_FIELDS = (
    "source_name", "source_url", "source_year", "retrieved_at",
    "processing_version", "raw_unit", "transformation_method", "raw_sha256",
)


class SourceError(ValueError):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_registry(root: Path = ROOT) -> dict:
    with (root / "config/data_sources.yaml").open() as handle:
        return yaml.safe_load(handle)["sources"]


def atomic_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, filename = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    os.close(descriptor)
    temporary = Path(filename)
    try:
        temporary.write_text(json.dumps(value, allow_nan=False, indent=2) + "\n")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def safe_url(url: str) -> str:
    parts = urlsplit(url)
    query = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True)
             if key.lower() not in {"key", "api_key", "apikey", "token"}]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ""))


def validate_artifact(path: Path, kind: str) -> None:
    if not path.exists() or path.stat().st_size < 32:
        raise SourceError("Source file is empty or implausibly small")
    with path.open("rb") as handle:
        start = handle.read(256).lstrip().lower()
    if start.startswith((b"<!doctype html", b"<html", b"<?xml")):
        raise SourceError("Expected dataset, received HTML/XML instead")
    if kind in {"zip", "xlsx"}:
        if not zipfile.is_zipfile(path):
            raise SourceError("Expected a valid ZIP/XLSX container")
        with zipfile.ZipFile(path) as archive:
            if not archive.namelist() or archive.testzip() is not None:
                raise SourceError("ZIP checksum validation failed")
            if sum(item.file_size for item in archive.infolist()) > 2_000_000_000:
                raise SourceError("Archive exceeds the 2 GB extraction limit")
    elif kind == "json":
        try:
            value = json.loads(path.read_text())
        except (UnicodeError, ValueError) as error:
            raise SourceError("Invalid JSON dataset") from error
        if isinstance(value, dict) and "error" in value:
            raise SourceError(f"Source API returned an error: {value['error']}")


def fips(value) -> str:
    text = str(value).strip()
    if text.endswith(".0"):
        text = text[:-2]
    if not text.isdigit() or len(text) > 5:
        raise SourceError(f"Invalid county FIPS: {value!r}")
    return text.zfill(5)


def number(value, minimum=None, maximum=None):
    if value is None or pd.isna(value) or str(value).strip() in {"", "-", "(NA)", "N", "(X)", "null"}:
        return None
    try:
        result = float(value)
    except (ValueError, TypeError) as error:
        raise SourceError(f"Non-numeric source value: {value!r}") from error
    if not math.isfinite(result) or result <= -999:
        return None
    if minimum is not None and result < minimum:
        raise SourceError(f"Value {result} is below {minimum}")
    if maximum is not None and result > maximum:
        raise SourceError(f"Value {result} exceeds {maximum}")
    return result


class SourceContext:
    def __init__(self, source_id: str, root: Path = ROOT, offline=False, refresh=False):
        self.root = root
        self.source_id = source_id
        self.config = read_registry(root)[source_id]
        self.raw_dir = root / self.config["raw_dir"]
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.offline = offline
        self.refresh = refresh
        self.session = requests.Session()
        self.session.headers["User-Agent"] = "CountyDecisionDataPipeline/1.0"
        self.events = []

    def request(self, url: str, **kwargs):
        last = None
        for attempt in range(2):
            try:
                response = self.session.get(url, timeout=(10, 35), **kwargs)
                response.raise_for_status()
                return response
            except requests.RequestException as error:
                last = error
                if attempt == 0:
                    time.sleep(0.5)
        raise SourceError(f"Request failed for {safe_url(url)} ({type(last).__name__})")

    def artifact(self, name: str, url: str | None, kind: str) -> tuple[Path, dict]:
        path = self.raw_dir / name
        pointer = self.raw_dir / (name + ".current.json")
        if pointer.exists() and not self.refresh:
            selected = json.loads(pointer.read_text())["filename"]
            if Path(selected).name != selected:
                raise SourceError("Invalid raw cache version pointer")
            path = self.raw_dir / selected
        sidecar = path.with_suffix(path.suffix + ".metadata.json")
        if path.exists() and not self.refresh:
            validate_artifact(path, kind)
            metadata = json.loads(sidecar.read_text()) if sidecar.exists() else self.local_metadata(path, url)
            if sha256(path) != metadata["sha256"]:
                raise SourceError(f"Raw checksum changed: {path.name}; raw files are immutable")
            self.events.append(f"Using cached {path.name}")
            return path, metadata
        if self.offline or not url:
            raise SourceError(f"Manual download required: {name}")
        response = self.request(url, stream=True)
        content_type = response.headers.get("Content-Type", "").lower()
        if "text/html" in content_type:
            response.close()
            raise SourceError(f"Dataset request returned HTML: {safe_url(response.url)}")
        limit = self.config.get("max_download_mb", 250) * 1024 * 1024
        if int(response.headers.get("Content-Length", 0)) > limit:
            response.close()
            raise SourceError("Download exceeds configured size limit; use manual download")
        candidate = path.with_suffix(path.suffix + ".part")
        started = time.monotonic()
        try:
            size = 0
            with candidate.open("wb") as handle:
                for block in response.iter_content(1024 * 1024):
                    size += len(block)
                    if size > limit or time.monotonic() - started > 180:
                        raise SourceError("Download exceeds size/time limit; use manual download")
                    handle.write(block)
            validate_artifact(candidate, kind)
            digest = sha256(candidate)
            destination = path if not path.exists() else path.with_name(f"{path.stem}-{digest[:12]}{path.suffix}")
            if destination.exists() and sha256(destination) != digest:
                raise SourceError("Immutable cache collision")
            if destination.exists():
                candidate.unlink()
            else:
                os.replace(candidate, destination)
            metadata = {
                "source_url": safe_url(url), "resolved_url": safe_url(response.url),
                "retrieved_at": now(), "sha256": digest, "size_bytes": size,
                "content_type": content_type, "acquisition": "official_download",
            }
            atomic_json(destination.with_suffix(destination.suffix + ".metadata.json"), metadata)
            atomic_json(pointer, {"filename": destination.name, "sha256": digest})
            self.events.append(f"Downloaded {destination.name} ({size} bytes) from {safe_url(url)}")
            return destination, metadata
        finally:
            response.close()
            candidate.unlink(missing_ok=True)

    def local_metadata(self, path: Path, url: str | None) -> dict:
        metadata = {
            "source_url": safe_url(url or self.config["source_page"]),
            "retrieved_at": now(), "sha256": sha256(path),
            "size_bytes": path.stat().st_size, "acquisition": "manual_official_export",
        }
        atomic_json(path.with_suffix(path.suffix + ".metadata.json"), metadata)
        return metadata

    def manual_file(self, extensions: tuple[str, ...]) -> tuple[Path, dict]:
        files = sorted(path for path in self.raw_dir.iterdir()
                       if path.suffix.lower() in extensions and not path.name.endswith(".metadata.json"))
        if not files:
            raise SourceError(f"Manual download required; see {self.raw_dir / 'README.md'}")
        if len(files) > 1:
            raise SourceError("Multiple manual exports found; keep one selected release in the raw source directory")
        path = files[0]
        sidecar = path.with_suffix(path.suffix + ".metadata.json")
        metadata = json.loads(sidecar.read_text()) if sidecar.exists() else self.local_metadata(path, None)
        if sha256(path) != metadata["sha256"]:
            raise SourceError("Manual artifact changed after caching")
        return path, metadata

    def metric(self, county_fips, name, raw_value, unit, metadata, method, *, scope="county", year=None) -> dict:
        return {
            "county_fips": fips(county_fips), "metric_name": name,
            "raw_value": raw_value, "raw_unit": unit,
            "source_name": self.config["name"], "source_url": metadata["source_url"],
            "source_year": year or self.config["source_year"],
            "retrieved_at": metadata["retrieved_at"], "raw_sha256": metadata["sha256"],
            "processing_version": VERSION, "transformation_method": method,
            "geographic_scope": scope, "status": "available" if raw_value is not None else "missing",
        }


def validate_measurements(rows: list[dict], counties: set[str]) -> None:
    if not rows:
        raise SourceError("No usable county measurements were produced")
    seen = set()
    for row in rows:
        key = (row["county_fips"], row["metric_name"])
        if key in seen:
            raise SourceError(f"Duplicate county/metric: {key}")
        seen.add(key)
        if row["county_fips"] not in counties:
            raise SourceError(f"Unmatched county FIPS: {row['county_fips']}")
        if any(field not in row or row[field] is None for field in PROVENANCE_FIELDS):
            raise SourceError(f"Incomplete provenance: {key}")
        value = row["raw_value"]
        if value is not None and (not isinstance(value, (float, int)) or not math.isfinite(value)):
            raise SourceError(f"Invalid measurement: {key}")
