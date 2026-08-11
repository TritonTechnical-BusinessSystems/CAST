/**
 * Nearest-port lookup (INIT-0012 §3.5) — lat/lon -> a friendly place name for
 * the Vessel Site writer, via an offline dataset. NOT reverse geocoding (the
 * architecture note explicitly rules that out: land-oriented geocoders
 * return nothing useful for a vessel at sea).
 *
 * Dataset (decided 2026-08-11, user): UN/LOCODE over NGA World Port Index —
 * the fleet is predominantly superyachts, which mostly anchor/dock at small
 * marinas, coves, and coastal towns, not major commercial shipping ports.
 * NGA's ~3,700 entries are commercial-port-biased and would badly miss those.
 * `ports.csv` is `cristan/improved-un-locodes`' code-list-improved.csv
 * (PDDL/ODbL/CC-0 — UN/LOCODE data is PDDL, coordinate improvements from
 * OpenStreetMap Nominatim (ODbL) + Wikidata (CC-0)), filtered down from
 * 116,075 rows (all UN/LOCODE function types — rail, air, road, etc.) to
 * 16,657: `Function` code starting with "1" (port/maritime) AND a valid,
 * non-deprecated `Status` (excludes XX "will be removed", UR "unauthorised",
 * blank) AND a present `CoordinatesDecimal`. Regenerate by re-running that
 * same filter against a fresh code-list-improved.csv download.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

interface Port {
  code: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
}

/** Beyond this, there's no meaningfully "nearby" port — call it "at sea" instead of naming something hundreds of miles off. */
export const AT_SEA_THRESHOLD_NM = 50;

let ports: Port[] | null = null;

function loadPorts(): Port[] {
  if (ports) return ports;
  const dir = dirname(fileURLToPath(import.meta.url));
  const csv = readFileSync(join(dir, "ports.csv"), "utf8");
  const lines = csv.split("\n").slice(1); // drop header
  const out: Port[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const [code, name, country, latS, lonS] = line.split(",");
    const lat = Number(latS);
    const lon = Number(lonS);
    if (!code || !name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ code, name, country, lat, lon });
  }
  ports = out;
  return out;
}

const EARTH_RADIUS_NM = 3440.065;

function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface NearestPortResult {
  name: string;
  country: string;
  distanceNm: number;
}

/** Nearest port within AT_SEA_THRESHOLD_NM, or null if nothing's close enough to be meaningful. */
export function nearestPort(lat: number, lon: number): NearestPortResult | null {
  let best: Port | null = null;
  let bestDist = Infinity;
  for (const p of loadPorts()) {
    const d = haversineNm(lat, lon, p.lat, p.lon);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  if (!best || bestDist > AT_SEA_THRESHOLD_NM) return null;
  return { name: best.name, country: best.country, distanceNm: bestDist };
}
