import fs from "node:fs";
import path from "node:path";
import { categoryKeys, type EvidenceItem, type LocationFeature } from "@/lib/types/domain";

export type StoreManifest = {
  data_mode: "seeded_demo" | "public_data";
  store_path?: string;
  partitioned_evidence?: boolean;
  processing_version?: string;
  normalization?: unknown;
  input_checksums?: { rules_sha256?: string };
};

export type StoreSnapshot = {
  manifest: StoreManifest;
  directory: string;
  features: LocationFeature[];
};

let cached: { key: string; snapshot: StoreSnapshot } | undefined;

function dataDirectory(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.DATA_DIR ?? "../../data/feature_store");
}

function readJson<T>(directory: string, fileName: string): T {
  const filePath = path.join(/*turbopackIgnore: true*/ directory, fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

export function getStoreSnapshot(): StoreSnapshot {
  const root = dataDirectory();
  const manifestPath = path.join(/*turbopackIgnore: true*/ root, "manifest.json");
  const key = root + ":" + fs.statSync(manifestPath).mtimeMs;
  if (cached?.key === key) return cached.snapshot;
  const manifest = readJson<StoreManifest>(root, "manifest.json");
  if (manifest.data_mode !== "public_data" && manifest.data_mode !== "seeded_demo") {
    throw new Error("Feature store has an invalid data mode. Run make data.");
  }
  if (manifest.store_path && !/^releases\/[a-f0-9]{20}$/.test(manifest.store_path)) {
    throw new Error("Invalid feature-store release path.");
  }
  const directory = path.join(/*turbopackIgnore: true*/ root, manifest.store_path ?? "");
  const features = readJson<LocationFeature[]>(directory, "location_features.json");
  if (!Array.isArray(features) || features.length === 0) throw new Error("Feature store is empty.");
  const seen = new Set<string>();
  for (const feature of features) {
    if (!/^\d{5}$/.test(feature.county_fips) || seen.has(feature.county_fips)) throw new Error("Invalid or duplicate county FIPS.");
    seen.add(feature.county_fips);
    if (!Number.isFinite(feature.lat) || Math.abs(feature.lat) > 90 || !Number.isFinite(feature.lon) || Math.abs(feature.lon) > 180) {
      throw new Error("Invalid county centroid.");
    }
    for (const category of categoryKeys) {
      const value = feature.category_scores[category];
      if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) throw new Error("Invalid category score.");
    }
    if (manifest.data_mode === "public_data" && feature.processing_version.startsWith("seed")) {
      throw new Error("Seeded features cannot be published as public data.");
    }
  }
  const snapshot = { manifest, directory, features };
  cached = { key, snapshot };
  return snapshot;
}

export function getLocationFeatures(snapshot = getStoreSnapshot()): LocationFeature[] {
  return snapshot.features;
}

export function getEvidenceStore(snapshot = getStoreSnapshot()): EvidenceItem[] {
  return readJson<EvidenceItem[]>(snapshot.directory, "evidence_store.json");
}

export function getEvidenceForLocation(locationId: string, snapshot = getStoreSnapshot()): EvidenceItem[] {
  if (!/^county-\d{5}$/.test(locationId)) return [];
  if (snapshot.manifest.partitioned_evidence) {
    return readJson<EvidenceItem[]>(snapshot.directory, "evidence/" + locationId + ".json");
  }
  return getEvidenceStore(snapshot).filter((item) => item.location_id === locationId);
}

export function getDataMode(snapshot = getStoreSnapshot()): "seeded_demo" | "public_data" {
  return snapshot.manifest.data_mode;
}
