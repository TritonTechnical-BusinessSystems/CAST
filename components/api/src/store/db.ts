/**
 * Shared better-sqlite3 database (INIT-0013 / INIT-0008). One connection, opened
 * at import, with the schema created idempotently. Used by the secret/settings
 * store and local break-glass accounts.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { join } from "path";

export const DATA_DIR = process.env.CAST_DATA_DIR ?? join(process.cwd(), ".data");
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
  -- CW-instance registry (multi-instance support, INIT-0026's Logistics rebuild).
  -- Credentials are NOT stored here -- they live in the encrypted secrets table,
  -- keyed "connectwise:{id}" (see connectwise/creds.ts). This table is just the
  -- id/display-name/default-flag registry so the UI can list + toggle instances
  -- without ever touching a secret value.
  CREATE TABLE IF NOT EXISTS cw_instances (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    -- Receiving settings (INIT-0026 Phase 1) -- per-instance, since PO
    -- statuses are CW-instance-specific data. Ported from LC's own
    -- cw_instances columns rather than a separate table -- same reasoning
    -- LC had: small amount of settings data, naturally scoped per instance,
    -- no need for a whole extra table/file for it.
    po_status_names TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
    week_begins_on INTEGER NOT NULL DEFAULT 1,  -- 0=Sunday..6=Saturday, default Monday
    sync_interval_minutes INTEGER NOT NULL DEFAULT 15
  );

  -- Logistics Configuration (INIT-0026 Phase 1) -- shared app-level config,
  -- NOT CW-instance-scoped (a "Ship As" branding identity, a carrier name,
  -- etc. are the same regardless of which CW instance a shipment happens to
  -- be against) -- ported from LogisticsCoordinator's own MAIN_SCHEMA_SQL
  -- (companies/config_carriers/config_currencies/export_statement_presets/
  -- ci_flags), which made the identical shared-vs-per-instance split.
  -- "logistics_" prefix keeps ownership obvious in cast.db's shared schema.
  CREATE TABLE IF NOT EXISTS logistics_companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address_line1 TEXT, address_line2 TEXT, city TEXT, state TEXT, zip TEXT, country TEXT,
    phone TEXT, email TEXT, tax_id TEXT,
    logo_filename TEXT,
    address_block TEXT, -- freeform alternative to the structured address fields above
    pdf_code TEXT,      -- short code appended to CI/PL filenames, e.g. "TT"
    ein TEXT, vat TEXT, eori TEXT,
    default_export_statement TEXT,
    primary_color TEXT, accent_color TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS logistics_carriers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS logistics_currencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS logistics_export_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS logistics_ci_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#1e3a5f',
    font_size INTEGER NOT NULL DEFAULT 9,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
`);

// Seed starter carriers/currencies, matching LC's own seed data exactly (idempotent).
if ((db.prepare("SELECT COUNT(*) as n FROM logistics_carriers").get() as { n: number }).n === 0) {
  const seedCarriers = db.prepare("INSERT INTO logistics_carriers (name, sort_order) VALUES (?, ?)");
  [["DHL", 1], ["FedEx", 2], ["UPS", 3], ["freight forwarder", 4], ["hand carry", 5]].forEach(([name, order]) =>
    seedCarriers.run(name, Number(order)),
  );
}
if ((db.prepare("SELECT COUNT(*) as n FROM logistics_currencies").get() as { n: number }).n === 0) {
  const seedCurrencies = db.prepare("INSERT INTO logistics_currencies (code, name, sort_order) VALUES (?, ?, ?)");
  [
    ["USD", "US Dollar", 1],
    ["EUR", "Euro", 2],
    ["GBP", "British Pound", 3],
  ].forEach(([code, name, order]) => seedCurrencies.run(code, name, Number(order)));
}

// Seed the two known instances (idempotent -- INSERT OR IGNORE) so the registry
// is never empty on a fresh box. Real credentials are configured separately via
// the Integrations screen per instance; an unconfigured instance just falls back
// to the stub CW client like the single-instance path always has.
db.exec(`
  INSERT OR IGNORE INTO cw_instances (id, name, is_default, created_at)
    VALUES ('tritontech', 'Production', 1, datetime('now'));
  INSERT OR IGNORE INTO cw_instances (id, name, is_default, created_at)
    VALUES ('tritontech_cs1', 'Sandbox', 0, datetime('now'));
`);

// Migrate pre-existing checkins tables to add device_name (the human machine name).
{
  const cols = (db.prepare("PRAGMA table_info(checkins)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("device_name")) db.exec("ALTER TABLE checkins ADD COLUMN device_name TEXT DEFAULT ''");
}

// Migrate pre-existing cw_instances tables (created during Phase 0, before the
// receiving-settings columns existed) to add them now.
{
  const cols = (db.prepare("PRAGMA table_info(cw_instances)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("po_status_names")) db.exec("ALTER TABLE cw_instances ADD COLUMN po_status_names TEXT NOT NULL DEFAULT '[]'");
  if (!cols.includes("week_begins_on")) db.exec("ALTER TABLE cw_instances ADD COLUMN week_begins_on INTEGER NOT NULL DEFAULT 1");
  if (!cols.includes("sync_interval_minutes")) db.exec("ALTER TABLE cw_instances ADD COLUMN sync_interval_minutes INTEGER NOT NULL DEFAULT 15");
}
