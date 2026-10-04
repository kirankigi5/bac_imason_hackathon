#!/usr/bin/env python3
from pathlib import Path

RAW_DIR = Path(__file__).resolve().parents[2] / "data" / "raw" / "usgs"

if __name__ == "__main__":
    print(f"USGS ingestion expects official local land-cover files. See {RAW_DIR / 'README.md'}")

