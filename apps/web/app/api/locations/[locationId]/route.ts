import { NextResponse } from "next/server";
import { getEvidenceForLocation, getLocationFeatures, getStoreSnapshot } from "@/lib/data/store";
import { versionsFor } from "@/lib/backend/decisions";
import { decisionCache, stableHash } from "@/lib/backend/cache";
import { metricQuality, rankingQuality } from "@/lib/decision-engine/metric-quality";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await context.params;
  const snapshot = getStoreSnapshot();
  const location = getLocationFeatures(snapshot).find((item) => item.location_id === locationId);
  if (!location) {
    return NextResponse.json({ error: "Location not found" }, { status: 404 });
  }
  return NextResponse.json(decisionCache.remember("detail:" + stableHash([versionsFor(snapshot), locationId]), () => {
    const evidence = getEvidenceForLocation(location.location_id, snapshot);
    return { ...versionsFor(snapshot), location: { ...location, ...rankingQuality(location) }, evidence, metric_quality: evidence.map(metricQuality) };
  }));
}
