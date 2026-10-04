"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { LngLatBoundsLike, Marker, StyleSpecification } from "maplibre-gl";
import type { DecisionTrace, LocationFeature, ProjectState, RankedLocation } from "@/lib/types/domain";
import { useAPIResource } from "@/lib/frontend/use-api-resource";

type Props = {
  results: RankedLocation[];
  excluded: RankedLocation[];
  selectedLocationId?: string;
  onSelect: (locationId: string) => void;
  disabled?: boolean;
  project?: ProjectState;
};

const rasterStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "OpenStreetMap"
    }
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm"
    }
  ]
};

export function DecisionMap({ results, excluded, selectedLocationId, onSelect, disabled, project }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const lastResults = useRef<RankedLocation[]>([]);
  const lastExtra = useRef<string | undefined>(undefined);
  const knownSelection = [...results, ...excluded].find((row) => row.location_id === selectedLocationId);
  const needsSelectedPoint = !!selectedLocationId && !knownSelection && !!project;
  const selectedFeature = useAPIResource<{ location: LocationFeature }>(`/api/locations/${selectedLocationId}`, undefined, needsSelectedPoint);
  const selectedTrace = useAPIResource<DecisionTrace>(`/api/locations/${selectedLocationId}/decision-trace`, { project }, needsSelectedPoint);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: rasterStyle,
      center: [-97.5, 39.2],
      zoom: 3.15,
      attributionControl: { compact: true }
    });
    mapRef.current.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      markersRef.current.forEach((marker) => marker.remove());
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const points: Array<Pick<RankedLocation, "location_id" | "county_name" | "state_code" | "lat" | "lon" | "overall_score"> & {
      rank: number | null; feasibility: Pick<RankedLocation["feasibility"], "is_feasible" | "status"> }> = results.filter((location) => location.feasibility.is_feasible);
    const extra = knownSelection ?? (selectedFeature.data && selectedTrace.data ? {
      ...selectedFeature.data.location, rank: selectedTrace.data.rank, overall_score: selectedTrace.data.overall_score,
      feasibility: selectedTrace.data.feasibility } : undefined);
    const extraID = extra && !points.some((point) => point.location_id === extra.location_id) ? extra.location_id : undefined;
    if (extraID && extra) points.push(extra);
    points.forEach((location) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "candidate-marker";
      element.dataset.selected = String(location.location_id === selectedLocationId);
      element.dataset.feasible = String(location.feasibility.is_feasible);
      element.dataset.status = location.feasibility.status;
      element.disabled = !!disabled;
      element.title = `${location.county_name}, ${location.state_code} score ${location.overall_score}`;
      element.setAttribute("aria-label", element.title + "; " + location.feasibility.status);
      element.textContent = location.feasibility.is_feasible ? `#${location.rank}` : "X";
      element.addEventListener("click", () => onSelect(location.location_id));

      const marker = new maplibregl.Marker({ element }).setLngLat([location.lon, location.lat]).addTo(map);
      markersRef.current.push(marker);
    });

    if (points.length > 0 && (results !== lastResults.current || extraID !== lastExtra.current)) {
      const bounds = points.reduce((nextBounds, location) => {
        nextBounds.extend([location.lon, location.lat]);
        return nextBounds;
      }, new maplibregl.LngLatBounds([points[0].lon, points[0].lat], [points[0].lon, points[0].lat]));
      map.fitBounds(bounds as LngLatBoundsLike, {
        padding: { top: 112, bottom: 64, left: 52, right: 52 },
        maxZoom: 5.6,
        duration: 650
      });
    }
    lastResults.current = results;
    lastExtra.current = extraID;
  }, [results, excluded, selectedLocationId, onSelect, disabled, knownSelection, selectedFeature.data, selectedTrace.data]);

  return (
    <section className="map-shell relative overflow-hidden border-r border-ink/10 bg-surface">
      <div ref={containerRef} className="h-full min-h-[inherit] w-full" />
      <div className="absolute left-4 top-4 max-w-[240px] rounded-md border border-ink/10 bg-surface/95 p-3 text-xs shadow-soft backdrop-blur">
        <div className="font-semibold text-ink">Decision Engine Map</div>
        <div className="mt-2 flex items-center gap-4 text-steel">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-aqua" />Candidates</span>
          <span>{excluded.length} excluded</span>
        </div>
      </div>
      {results.length === 0 ? (
        <div className="absolute inset-x-4 bottom-8 rounded-md border border-saffron/30 bg-surface/95 p-3 text-sm text-ink shadow-soft">
          {excluded.length ? "No counties satisfy the current constraints." : "Complete the intake prompt to run feasibility and ranking."}
        </div>
      ) : null}
    </section>
  );
}
