/**
 * Geo areas + point-in-area tests for Geo Alerts (INIT-0017). Areas are defined
 * in the app; the aisstream monitor (INIT-0012) will test each vessel position
 * against them and fire the configured action on entry.
 */
export type Area =
  | { id: string; name: string; kind: "circle"; centerLat: number; centerLon: number; radiusKm: number }
  | { id: string; name: string; kind: "bbox"; minLat: number; minLon: number; maxLat: number; maxLon: number };

export interface GeoAlertConfig {
  areas: Area[];
  /** What to do when a tracked vessel enters an area (executed by the monitor). */
  action: { type: "cw-flag" | "teams" | "none"; note: string };
}

export const DEFAULT_GEO_CONFIG: GeoAlertConfig = { areas: [], action: { type: "none", note: "" } };

const EARTH_KM = 6371;

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(s));
}

export function pointInArea(lat: number, lon: number, area: Area): boolean {
  if (area.kind === "circle") return haversineKm(lat, lon, area.centerLat, area.centerLon) <= area.radiusKm;
  return lat >= area.minLat && lat <= area.maxLat && lon >= area.minLon && lon <= area.maxLon;
}

/** Areas a point falls within — used by the monitor to trigger alerts. */
export function areasContaining(lat: number, lon: number, areas: Area[]): Area[] {
  return areas.filter((a) => pointInArea(lat, lon, a));
}
