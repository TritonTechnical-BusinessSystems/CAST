/**
 * AIS position + voyage data per vessel (INIT-0012). Two tables, both written
 * by `aisListener.ts` as PositionReport/StandardClassBPositionReport
 * (position) and ShipStaticData (voyage: destination/ETA) messages arrive:
 * `vessel_positions`, one row per MMSI (latest-only, upserted); and
 * `vessel_position_history` (INIT-0033), insert-only, one row per real
 * update received, for the Vessel Location tree's expandable history. The
 * two upserts are independent (each only touches its own columns) since the
 * two message types arrive on very different cadences and shouldn't clobber
 * each other.
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

const insertHistoryStmt = db.prepare(`
  INSERT INTO vessel_position_history (mmsi, kind, lat, lon, sog, cog, nav_status_code, destination, eta_iso, recorded_at)
  VALUES (@mmsi, @kind, @lat, @lon, @sog, @cog, @navStatusCode, @destination, @etaIso, @recordedAt)
`);

// Per-MMSI cap so vessel_position_history can't grow unbounded on the same
// volume that holds the encrypted secrets table (flagged in the v0.10.0
// security review) -- a third party's message rate, not CAST's own code,
// otherwise decides this table's size. Uses the existing (mmsi, id DESC)
// index for both sides of the subquery, so it stays cheap even as a single
// vessel's row count grows. Only run every PRUNE_EVERY_N inserts (not on
// every single one) since it's still a synchronous, event-loop-blocking
// statement -- at the fleet's actual observed delivery rate this adds
// negligible overhead while still bounding growth over time.
const HISTORY_ROWS_PER_MMSI = 5000;
const PRUNE_EVERY_N = 50;
let insertsSincePrune = 0;

const pruneHistoryStmt = db.prepare(`
  DELETE FROM vessel_position_history
  WHERE mmsi = @mmsi AND id NOT IN (
    SELECT id FROM vessel_position_history WHERE mmsi = @mmsi ORDER BY id DESC LIMIT @keep
  )
`);

function recordHistory(entry: {
  mmsi: string;
  kind: "position" | "voyage";
  lat: number | null;
  lon: number | null;
  sog: number | null;
  cog: number | null;
  navStatusCode: number | null;
  destination: string | null;
  etaIso: string | null;
  recordedAt: string;
}): void {
  insertHistoryStmt.run(entry);
  insertsSincePrune++;
  if (insertsSincePrune >= PRUNE_EVERY_N) {
    insertsSincePrune = 0;
    pruneHistoryStmt.run({ mmsi: entry.mmsi, keep: HISTORY_ROWS_PER_MMSI });
  }
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
  recordHistory({
    mmsi: p.mmsi,
    kind: "position",
    lat: p.lat,
    lon: p.lon,
    sog: p.sog,
    cog: p.cog,
    navStatusCode: p.navStatusCode,
    destination: null,
    etaIso: null,
    recordedAt: p.lastSeenAt,
  });
}

const upsertVoyageStmt = db.prepare(`
  INSERT INTO vessel_positions (mmsi, destination, eta_iso, voyage_updated_at, last_seen_at)
  VALUES (@mmsi, @destination, @etaIso, @voyageUpdatedAt, @voyageUpdatedAt)
  ON CONFLICT(mmsi) DO UPDATE SET
    destination = excluded.destination, eta_iso = excluded.eta_iso, voyage_updated_at = excluded.voyage_updated_at
`);

export function upsertVoyage(v: { mmsi: string; destination: string | null; etaIso: string | null; voyageUpdatedAt: string }): void {
  upsertVoyageStmt.run(v);
  recordHistory({
    mmsi: v.mmsi,
    kind: "voyage",
    lat: null,
    lon: null,
    sog: null,
    cog: null,
    navStatusCode: null,
    destination: v.destination,
    etaIso: v.etaIso,
    recordedAt: v.voyageUpdatedAt,
  });
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

export interface VesselHistoryEntry {
  id: number;
  kind: "position" | "voyage";
  lat: number | null;
  lon: number | null;
  sog: number | null;
  cog: number | null;
  navStatusCode: number | null;
  destination: string | null;
  etaIso: string | null;
  recordedAt: string;
}

interface HistoryRow {
  id: number;
  kind: string;
  lat: number | null;
  lon: number | null;
  sog: number | null;
  cog: number | null;
  nav_status_code: number | null;
  destination: string | null;
  eta_iso: string | null;
  recorded_at: string;
}

const listHistoryStmt = db.prepare(`
  SELECT id, kind, lat, lon, sog, cog, nav_status_code, destination, eta_iso, recorded_at
  FROM vessel_position_history WHERE mmsi = ? ORDER BY recorded_at DESC, id DESC LIMIT ?
`);

/**
 * Most recent updates received for one vessel, newest first — sorted by
 * `recorded_at` (the value actually shown in the "Received" column), with
 * `id` (receipt order) as the tiebreak. NOT sorted by `id` alone: a position
 * row's `recorded_at` is the AIS station's own self-reported time, while a
 * voyage row's is CAST's receipt time — two different clocks that don't
 * share an ordering guarantee, so id-order could show an earlier-timestamped
 * row above a later one. `recorded_at` is what a person reads top-to-bottom,
 * so it's what determines the order they see.
 */
export function listHistory(mmsi: string, limit: number): VesselHistoryEntry[] {
  const rows = listHistoryStmt.all(mmsi, limit) as HistoryRow[];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as "position" | "voyage",
    lat: r.lat,
    lon: r.lon,
    sog: r.sog,
    cog: r.cog,
    navStatusCode: r.nav_status_code,
    destination: r.destination,
    etaIso: r.eta_iso,
    recordedAt: r.recorded_at,
  }));
}
