/**
 * Shared better-sqlite3 database (INIT-0013 / INIT-0008). One connection, opened
 * at import, with the schema created idempotently. Used by the secret/settings
 * store and local break-glass accounts.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = process.env.CAST_DATA_DIR ?? join(process.cwd(), ".data");
mkdirSync(DATA_DIR, { recursive: true });

/** Path for the AES key file fallback (used when CAST_SECRET_KEY is unset). */
export const DB_KEY_FILE = join(DATA_DIR, "secret.key");

export const db: Database.Database = new Database(join(DATA_DIR, "cast.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS secrets  (name TEXT PRIMARY KEY, iv TEXT NOT NULL, tag TEXT NOT NULL, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS local_accounts (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS checkins (
    device_id TEXT PRIMARY KEY,
    device_name TEXT, browser TEXT, os_user TEXT, cw_member_id TEXT,
    extension_version TEXT, rules_version TEXT,
    last_check_in TEXT NOT NULL
  );
  -- Latest-known AIS position per vessel (INIT-0012) -- upserted continuously
  -- by the WS listener, one row per MMSI. Latest-only, no history: same file
  -- as everything else, not a separate database (see the architecture note's
  -- "Position-history volume & storage" decision -- a history/time-series
  -- store would be a distinct, separate concern, not built here).
  CREATE TABLE IF NOT EXISTS vessel_positions (
    mmsi TEXT PRIMARY KEY,
    lat REAL, lon REAL, sog REAL, cog REAL,
    nav_status_code INTEGER,
    last_seen_at TEXT NOT NULL,
    -- Voyage data (ShipStaticData, not PositionReport) -- a different AIS
    -- message type on a much slower cadence, but the same one-row-per-MMSI
    -- cache; destination feeds the "underway to <destination>" site name.
    destination TEXT,
    eta_iso TEXT,
    voyage_updated_at TEXT
  );
`);

// Migrate pre-existing checkins tables to add device_name (the human machine name).
{
  const cols = (db.prepare("PRAGMA table_info(checkins)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("device_name")) db.exec("ALTER TABLE checkins ADD COLUMN device_name TEXT DEFAULT ''");
}
