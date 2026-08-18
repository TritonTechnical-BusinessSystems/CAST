/**
 * Coordinates -> ConnectWise Site "Time Zone" reference field. CW's own
 * `/system/timeZoneSetups` (what the Site's `timeZone` field actually
 * references) is a fixed, small list of 94 entries — verified live
 * 2026-08-17 against a real Vessel site (`timeZone: {id, name}`, e.g.
 * `{id: 1, name: "GMT-5/Eastern Time: US & Canada"}`). This is NOT the
 * `/system/timeZones` endpoint (a different, unrelated reference list with
 * Windows "Standard Time" names) — an early check against the wrong
 * endpoint during this same investigation.
 *
 * CW's list uses city-label names, not IANA identifiers, and exposes no
 * offset/DST data of its own — so matching can't be a name lookup. Instead:
 * each of the 94 entries below is hand-mapped to one representative real
 * IANA zone plus that zone's approximate coordinates (built from the live
 * list, 2026-08-17). At request time: compute each candidate's CURRENT UTC
 * offset live via Intl (correct for today's actual DST state, so a stale
 * label like #46 grouping Minsk with Kyiv/Sofia at "GMT+2" — Minsk has
 * actually been a fixed +3 for years — still resolves correctly, since the
 * comparison never trusts the label text). Rank candidates by (offset
 * difference, then geographic distance to the vessel) — the distance
 * tiebreak matters because MANY entries share the same current offset (six
 * separate GMT+1 European entries, for one), and picking the first
 * numerically-tied match rather than the geographically nearest one is a
 * real bug this file used to have: a Greek vessel at 37.98°N resolved to
 * id 39 ("Amman") over id 40 ("Athens, Bucharest, Istanbul") purely because
 * 39 came first in the array — both currently sit at +3 (Jordan dropped DST
 * in 2022, landing it on the same real offset as Greece's summer EEST), but
 * Athens is the obviously correct match. Found live-testing against real
 * production position data before shipping.
 */
import tzlookup from "tz-lookup";

interface TimeZoneSetup {
  id: number;
  ianaZone: string;
  lat: number;
  lon: number;
}

export const CW_TIMEZONE_SETUPS: TimeZoneSetup[] = [
  { id: 1, ianaZone: "America/New_York", lat: 40.71, lon: -74.01 },
  { id: 2, ianaZone: "America/Chicago", lat: 41.88, lon: -87.63 },
  { id: 3, ianaZone: "America/Denver", lat: 39.74, lon: -104.99 },
  { id: 4, ianaZone: "America/Los_Angeles", lat: 34.05, lon: -118.24 },
  { id: 5, ianaZone: "America/Sao_Paulo", lat: -15.79, lon: -47.88 },
  { id: 6, ianaZone: "Europe/London", lat: 51.51, lon: -0.13 },
  { id: 7, ianaZone: "Europe/Paris", lat: 48.85, lon: 2.35 },
  { id: 8, ianaZone: "America/Anchorage", lat: 61.22, lon: -149.9 },
  { id: 9, ianaZone: "Pacific/Honolulu", lat: 21.31, lon: -157.86 },
  { id: 10, ianaZone: "Pacific/Midway", lat: 28.21, lon: -177.37 },
  { id: 11, ianaZone: "America/Tijuana", lat: 32.51, lon: -117.02 },
  { id: 12, ianaZone: "America/Phoenix", lat: 33.45, lon: -112.07 },
  { id: 13, ianaZone: "America/Chihuahua", lat: 28.63, lon: -106.09 },
  { id: 14, ianaZone: "America/Guatemala", lat: 14.63, lon: -90.51 },
  { id: 15, ianaZone: "America/Mexico_City", lat: 19.43, lon: -99.13 },
  { id: 16, ianaZone: "America/Regina", lat: 50.45, lon: -104.62 },
  { id: 17, ianaZone: "America/Indiana/Indianapolis", lat: 39.77, lon: -86.16 },
  { id: 18, ianaZone: "America/Caracas", lat: 10.48, lon: -66.9 },
  { id: 19, ianaZone: "America/Halifax", lat: 44.65, lon: -63.57 },
  { id: 20, ianaZone: "America/Manaus", lat: -3.1, lon: -60.02 },
  { id: 21, ianaZone: "America/Santiago", lat: -33.45, lon: -70.67 },
  { id: 22, ianaZone: "America/St_Johns", lat: 47.56, lon: -52.71 },
  { id: 23, ianaZone: "America/Argentina/Buenos_Aires", lat: -34.6, lon: -58.38 },
  { id: 24, ianaZone: "America/Godthab", lat: 64.18, lon: -51.69 },
  { id: 25, ianaZone: "America/Montevideo", lat: -34.9, lon: -56.16 },
  { id: 26, ianaZone: "Etc/GMT+2", lat: 0, lon: -30 },
  { id: 27, ianaZone: "Etc/GMT+12", lat: 0, lon: -180 },
  { id: 28, ianaZone: "America/Bogota", lat: 4.71, lon: -74.07 },
  { id: 29, ianaZone: "America/La_Paz", lat: -16.5, lon: -68.15 },
  { id: 30, ianaZone: "America/Cayenne", lat: 6.8, lon: -58.16 },
  { id: 31, ianaZone: "Atlantic/Azores", lat: 37.74, lon: -25.67 },
  { id: 32, ianaZone: "Atlantic/Cape_Verde", lat: 14.93, lon: -23.51 },
  { id: 33, ianaZone: "Africa/Casablanca", lat: 33.57, lon: -7.59 },
  { id: 34, ianaZone: "Atlantic/Reykjavik", lat: 64.15, lon: -21.94 },
  { id: 35, ianaZone: "Europe/Berlin", lat: 52.52, lon: 13.4 },
  { id: 36, ianaZone: "Europe/Belgrade", lat: 44.79, lon: 20.45 },
  { id: 37, ianaZone: "Europe/Warsaw", lat: 52.23, lon: 21.01 },
  { id: 38, ianaZone: "Africa/Lagos", lat: 6.52, lon: 3.38 },
  { id: 39, ianaZone: "Asia/Amman", lat: 31.95, lon: 35.93 },
  { id: 40, ianaZone: "Europe/Athens", lat: 37.98, lon: 23.73 },
  { id: 41, ianaZone: "Asia/Beirut", lat: 33.89, lon: 35.5 },
  { id: 42, ianaZone: "Africa/Cairo", lat: 30.04, lon: 31.24 },
  { id: 43, ianaZone: "Africa/Johannesburg", lat: -26.2, lon: 28.05 },
  { id: 44, ianaZone: "Europe/Helsinki", lat: 60.17, lon: 24.94 },
  { id: 45, ianaZone: "Asia/Jerusalem", lat: 31.77, lon: 35.21 },
  { id: 46, ianaZone: "Europe/Minsk", lat: 53.9, lon: 27.57 },
  { id: 47, ianaZone: "Africa/Windhoek", lat: -22.56, lon: 17.08 },
  { id: 48, ianaZone: "Asia/Baghdad", lat: 33.31, lon: 44.36 },
  { id: 49, ianaZone: "Asia/Riyadh", lat: 24.71, lon: 46.68 },
  { id: 50, ianaZone: "Europe/Moscow", lat: 55.76, lon: 37.62 },
  { id: 51, ianaZone: "Africa/Nairobi", lat: -1.29, lon: 36.82 },
  { id: 52, ianaZone: "Asia/Tehran", lat: 35.69, lon: 51.39 },
  { id: 53, ianaZone: "Asia/Dubai", lat: 25.2, lon: 55.27 },
  { id: 54, ianaZone: "Asia/Baku", lat: 40.41, lon: 49.87 },
  { id: 55, ianaZone: "Indian/Mauritius", lat: -20.16, lon: 57.5 },
  { id: 56, ianaZone: "Asia/Tbilisi", lat: 41.72, lon: 44.79 },
  { id: 57, ianaZone: "Asia/Yerevan", lat: 40.18, lon: 44.51 },
  { id: 58, ianaZone: "Asia/Kabul", lat: 34.56, lon: 69.21 },
  { id: 59, ianaZone: "Asia/Yekaterinburg", lat: 56.84, lon: 60.61 },
  { id: 60, ianaZone: "Asia/Karachi", lat: 24.86, lon: 67.0 },
  { id: 61, ianaZone: "Asia/Tashkent", lat: 41.3, lon: 69.24 },
  { id: 62, ianaZone: "Asia/Kolkata", lat: 22.57, lon: 88.36 },
  { id: 63, ianaZone: "Asia/Colombo", lat: 6.93, lon: 79.85 },
  { id: 64, ianaZone: "Asia/Kathmandu", lat: 27.72, lon: 85.32 },
  { id: 65, ianaZone: "Asia/Dhaka", lat: 23.81, lon: 90.41 },
  { id: 66, ianaZone: "Asia/Novosibirsk", lat: 55.03, lon: 82.92 },
  { id: 67, ianaZone: "Asia/Yangon", lat: 16.87, lon: 96.2 },
  { id: 68, ianaZone: "Asia/Bangkok", lat: 13.75, lon: 100.5 },
  { id: 69, ianaZone: "Asia/Krasnoyarsk", lat: 56.02, lon: 92.87 },
  { id: 70, ianaZone: "Asia/Shanghai", lat: 39.9, lon: 116.4 },
  { id: 71, ianaZone: "Asia/Irkutsk", lat: 52.29, lon: 104.3 },
  { id: 72, ianaZone: "Asia/Singapore", lat: 1.35, lon: 103.82 },
  { id: 73, ianaZone: "Australia/Perth", lat: -31.95, lon: 115.86 },
  { id: 74, ianaZone: "Asia/Taipei", lat: 25.03, lon: 121.57 },
  { id: 75, ianaZone: "Asia/Ulaanbaatar", lat: 47.89, lon: 106.91 },
  { id: 76, ianaZone: "Asia/Tokyo", lat: 35.68, lon: 139.69 },
  { id: 77, ianaZone: "Asia/Seoul", lat: 37.57, lon: 126.98 },
  { id: 78, ianaZone: "Asia/Yakutsk", lat: 62.03, lon: 129.73 },
  { id: 79, ianaZone: "Australia/Adelaide", lat: -34.93, lon: 138.6 },
  { id: 80, ianaZone: "Australia/Darwin", lat: -12.46, lon: 130.84 },
  { id: 81, ianaZone: "Australia/Brisbane", lat: -27.47, lon: 153.03 },
  { id: 82, ianaZone: "Australia/Sydney", lat: -33.87, lon: 151.21 },
  { id: 83, ianaZone: "Pacific/Guam", lat: 13.44, lon: 144.79 },
  { id: 84, ianaZone: "Australia/Hobart", lat: -42.88, lon: 147.33 },
  { id: 85, ianaZone: "Asia/Vladivostok", lat: 43.12, lon: 131.89 },
  { id: 86, ianaZone: "Pacific/Guadalcanal", lat: -9.43, lon: 159.95 },
  { id: 87, ianaZone: "Pacific/Auckland", lat: -36.85, lon: 174.76 },
  { id: 88, ianaZone: "Pacific/Fiji", lat: -17.71, lon: 178.07 },
  { id: 89, ianaZone: "Pacific/Tongatapu", lat: -21.14, lon: -175.2 },
  { id: 90, ianaZone: "Australia/Eucla", lat: -31.68, lon: 128.88 },
  { id: 91, ianaZone: "Australia/Lord_Howe", lat: -31.55, lon: 159.08 },
  { id: 92, ianaZone: "Pacific/Marquesas", lat: -9.78, lon: -139.03 },
  { id: 93, ianaZone: "Pacific/Kiritimati", lat: 1.87, lon: -157.38 },
  { id: 94, ianaZone: "Pacific/Chatham", lat: -43.95, lon: -176.56 },
];

// A tiny, deliberately small fallback: only used if a coordinate lookup
// itself fails (tz-lookup covers the whole globe including open ocean via
// longitude-banded nautical zones, so this should be rare in practice).
// Covers countries where the fleet's yachts realistically cruise.
const COUNTRY_TO_IANA: Record<string, string> = {
  US: "America/New_York",
  FR: "Europe/Paris",
  IT: "Europe/Rome",
  ES: "Europe/Madrid",
  MC: "Europe/Monaco",
  GR: "Europe/Athens",
  HR: "Europe/Zagreb",
  TR: "Europe/Istanbul",
  GB: "Europe/London",
  MT: "Europe/Malta",
  AE: "Asia/Dubai",
  BS: "America/Nassau",
  VG: "America/Tortola",
  KY: "America/Cayman",
  AU: "Australia/Sydney",
  NZ: "Pacific/Auckland",
  TH: "Asia/Bangkok",
  SG: "Asia/Singapore",
};

/** Current UTC offset in minutes for an IANA zone, as of right now — DST-aware. */
function currentOffsetMinutes(ianaZone: string): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ianaZone,
    timeZoneName: "shortOffset",
  }).formatToParts(now);
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const m = tzPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const hours = Number(m[2]);
  const mins = Number(m[3] ?? 0);
  return sign * (hours * 60 + mins);
}

// The 94 CW entries' offsets only depend on "what time is it," never on
// which vessel is being resolved -- so recomputing all 94 (each a real
// Intl.DateTimeFormat construction, not free) for every vessel in a batch of
// up to 60 was pure waste: ~5,600 redundant Intl calls per 5-minute
// tier-refresh cycle. Cached per real-world minute (offsets can't change
// faster than that) so a whole batch shares one computation.
let cwOffsetsCacheMinute = -1;
let cwOffsetsCache: number[] = [];

function currentCwOffsets(): number[] {
  const minute = Math.floor(Date.now() / 60_000);
  if (minute !== cwOffsetsCacheMinute) {
    cwOffsetsCache = CW_TIMEZONE_SETUPS.map((s) => currentOffsetMinutes(s.ianaZone));
    cwOffsetsCacheMinute = minute;
  }
  return cwOffsetsCache;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Ranked by (current offset difference, then geographic distance to the
 * point) — offset match is the real requirement (a "Time Zone" field should
 * show the right local time), distance only breaks ties among the several
 * CW entries that commonly share an offset.
 */
function closestSetupToPoint(targetOffsetMinutes: number, lat: number, lon: number): number {
  const offsets = currentCwOffsets();
  let best = CW_TIMEZONE_SETUPS[0];
  let bestOffsetDiff = Infinity;
  let bestDistanceKm = Infinity;
  for (let i = 0; i < CW_TIMEZONE_SETUPS.length; i++) {
    const setup = CW_TIMEZONE_SETUPS[i];
    const offsetDiff = Math.abs(offsets[i] - targetOffsetMinutes);
    if (offsetDiff > bestOffsetDiff) continue;
    const distanceKm = haversineKm(lat, lon, setup.lat, setup.lon);
    if (offsetDiff < bestOffsetDiff || distanceKm < bestDistanceKm) {
      best = setup;
      bestOffsetDiff = offsetDiff;
      bestDistanceKm = distanceKm;
    }
  }
  return best.id;
}

/**
 * Priority 1: the vessel's own coordinates (precise, and covers open ocean —
 * tz-lookup resolves every point on Earth to some zone). Priority 2 (rare —
 * only if the coordinate lookup itself throws): the vessel's resolved
 * CURRENT place, by country. Deliberately never falls back to `destination`
 * — that's where the vessel is headed, not where it is, and would assign
 * the wrong timezone for anything still underway.
 */
export function resolveTimeZoneSetupId(lat: number, lon: number, fallbackCountryCode?: string | null): number | null {
  try {
    const zone = tzlookup(lat, lon);
    return closestSetupToPoint(currentOffsetMinutes(zone), lat, lon);
  } catch {
    if (fallbackCountryCode && COUNTRY_TO_IANA[fallbackCountryCode]) {
      return closestSetupToPoint(currentOffsetMinutes(COUNTRY_TO_IANA[fallbackCountryCode]), lat, lon);
    }
    return null;
  }
}
