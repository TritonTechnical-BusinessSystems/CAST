/**
 * Latest-known AIS position + voyage data per vessel (INIT-0012) -- one row
 * per MMSI in the shared `cast.db` (`vessel_positions`), upserted by
 * `aisListener.ts` as PositionReport/StandardClassBPositionReport (position)
 * and ShipStaticData (voyage: destination/ETA) messages arrive. Latest-only,
 * no history -- see db.ts's table comment for why this doesn't need a
 * separate database. The two upserts are independent (each only touches its
 * own columns) since the two message types arrive on very different
 * cadences and shouldn't clobber each other.
 */
import { db } from "../store/db";

export interface VesselPosition {
  mmsi: string;
  lat: number | null;
  lon: number | null;
  sog: number | null;
  cog: number | null;
  navStatusCode: number | null;
  lastSeenAt: string;
  destination: string | null;
  etaIso: string | null;
  voyageUpdatedAt: string | null;
}

const upsertPositionStmt = db.prepare(`
  INSERT INTO vessel_positions (mmsi, lat, lon, sog, cog, nav_status_code, last_seen_at)
  VALUES (@mmsi, @lat, @lon, @sog, @cog, @navStatusCode, @lastSeenAt)
  ON CONFLICT(mmsi) DO UPDATE SET
    lat = excluded.lat, lon = excluded.lon, sog = excluded.sog, cog = excluded.cog,
    nav_status_code = excluded.nav_status_code, last_seen_at = excluded.last_seen_at
`);

export function upsertPosition(p: {
  mmsi: string;
  lat: number | null;
  lon: number | null;
  sog: number | null;
  cog: number | null;
  navStatusCode: number | null;
  lastSeenAt: string;
}): void {
  upsertPositionStmt.run(p);
}

const upsertVoyageStmt = db.prepare(`
  INSERT INTO vessel_positions (mmsi, destination, eta_iso, voyage_updated_at, last_seen_at)
  VALUES (@mmsi, @destination, @etaIso, @voyageUpdatedAt, @voyageUpdatedAt)
  ON CONFLICT(mmsi) DO UPDATE SET
    destination = excluded.destination, eta_iso = excluded.eta_iso, voyage_updated_at = excluded.voyage_updated_at
`);

export function upsertVoyage(v: { mmsi: string; destination: string | null; etaIso: string | null; voyageUpdatedAt: string }): void {
  upsertVoyageStmt.run(v);
}

interface PositionRow {
  mmsi: string;
  lat: number | null;
  lon: number | null;
  sog: number | null;
  cog: number | null;
  nav_status_code: number | null;
  last_seen_at: string | null;
  destination: string | null;
  eta_iso: string | null;
  voyage_updated_at: string | null;
}

function fromRow(r: PositionRow): VesselPosition {
  return {
    mmsi: r.mmsi,
    lat: r.lat,
    lon: r.lon,
    sog: r.sog,
    cog: r.cog,
    navStatusCode: r.nav_status_code,
    lastSeenAt: r.last_seen_at ?? "",
    destination: r.destination,
    etaIso: r.eta_iso,
    voyageUpdatedAt: r.voyage_updated_at,
  };
}

export function getPosition(mmsi: string): VesselPosition | undefined {
  const row = db.prepare("SELECT * FROM vessel_positions WHERE mmsi = ?").get(mmsi) as PositionRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function listPositions(): VesselPosition[] {
  const rows = db.prepare("SELECT * FROM vessel_positions").all() as PositionRow[];
  return rows.map(fromRow);
}
