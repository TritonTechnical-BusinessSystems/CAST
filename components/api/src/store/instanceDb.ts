/**
 * Per-CW-instance database (INIT-0026's Logistics rebuild, multi-instance
 * architecture). Each CW instance (e.g. "tritontech" prod, "tritontech_cs1"
 * sandbox) gets its own SQLite file, `cast_{instanceId}.db`, so production
 * and sandbox stay fully isolated -- and can run *concurrently*, not just be
 * switched between one at a time -- per the user's explicit requirement.
 *
 * Naming and layering follow `store/db.ts` exactly (same better-sqlite3 +
 * idempotent `CREATE TABLE IF NOT EXISTS` migration convention): `cast.db`
 * holds app-level data (settings, secrets, auth, the `cw_instances`
 * registry); this file holds everything that's *scoped to one CW instance*
 * -- ported from LogisticsCoordinator's own per-instance schema
 * (`LogisticsCoordinator/backend/app/database.py`, `INSTANCE_SCHEMA_SQL`).
 */
import Database from "better-sqlite3";
import { join } from "path";

const DATA_DIR = process.env.CAST_DATA_DIR ?? join(process.cwd(), ".data");

const INSTANCE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS shipments (
    id TEXT PRIMARY KEY, -- the CW ticket number, per LC's own convention
    cw_ticket_id INTEGER,
    company_id INTEGER,
    status TEXT DEFAULT 'draft',
    incoterm TEXT,
    carrier TEXT,
    currency TEXT DEFAULT 'USD',
    awb_number TEXT,
    weight REAL,
    show_weight_per_item INTEGER DEFAULT 0,
    consignee_name TEXT,
    consignee_address TEXT,
    ship_to_same_as_consignee INTEGER DEFAULT 1,
    ship_to_name TEXT,
    ship_to_address TEXT,
    export_statement TEXT,
    ci_flag_id INTEGER,
    ci_date TEXT,
    shipper_tax_field TEXT,
    consignee_tax_field TEXT,
    consignee_ein TEXT,
    consignee_vat TEXT,
    consignee_eori TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS containers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('pallet', 'box')),
    number INTEGER NOT NULL,
    parent_pallet_id INTEGER REFERENCES containers(id) ON DELETE CASCADE,
    weight REAL,
    notes TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_containers_shipment ON containers(shipment_id);

  CREATE TABLE IF NOT EXISTS container_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    container_id INTEGER NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
    cw_product_id INTEGER NOT NULL,
    cw_ticket_id INTEGER,
    cw_ticket_type TEXT,
    quantity REAL NOT NULL,
    price_source TEXT CHECK (price_source IN ('max_sold', 'avg_sold', 'catalog_price', 'catalog_msrp', 'manual')),
    manual_price REAL,
    description_override TEXT,
    hs_code_override TEXT,
    country_of_origin_override TEXT,
    serial_numbers TEXT, -- JSON array of strings
    part_number TEXT,
    catalog_item_id INTEGER,
    unit_price REAL,
    msrp REAL,
    unit_of_measure TEXT,
    source_ticket_id INTEGER,
    manufacturer TEXT,
    description TEXT -- live/synced description; description_override (above) wins when set
  );
  CREATE INDEX IF NOT EXISTS idx_container_items_container ON container_items(container_id);

  CREATE TABLE IF NOT EXISTS catalog_item_cache (
    catalog_item_id INTEGER PRIMARY KEY,
    hs_code TEXT,
    country_of_origin TEXT,
    catalog_price REAL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    doc_type TEXT NOT NULL CHECK (doc_type IN ('packing_list', 'commercial_invoice')),
    pdf_filename TEXT NOT NULL,
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    cw_document_id INTEGER,
    posted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_documents_shipment ON documents(shipment_id);

  CREATE TABLE IF NOT EXISTS inbound_line_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL,
    po_number TEXT,
    vendor_name TEXT,
    warehouse_id INTEGER,
    warehouse_name TEXT,
    catalog_item_id INTEGER,
    part_number TEXT,
    description TEXT,
    quantity_ordered REAL,
    quantity_received REAL,
    quantity_assigned REAL NOT NULL DEFAULT 0,
    expected_date TEXT,
    is_custom_order INTEGER NOT NULL DEFAULT 0,
    destination_bin_id INTEGER,
    destination_bin_name TEXT,
    cw_default_bin_id INTEGER,
    cw_default_bin_name TEXT,
    is_stale INTEGER NOT NULL DEFAULT 0,
    last_synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS inbound_line_item_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_item_id INTEGER NOT NULL REFERENCES inbound_line_items(id) ON DELETE CASCADE,
    ticket_id INTEGER,
    ticket_summary TEXT,
    project_id INTEGER,
    project_name TEXT,
    suggested_quantity REAL
  );
  CREATE INDEX IF NOT EXISTS idx_ilis_line_item ON inbound_line_item_sources(line_item_id);

  CREATE TABLE IF NOT EXISTS open_demand (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    catalog_item_id INTEGER NOT NULL,
    ticket_id INTEGER,
    project_id INTEGER,
    quantity REAL,
    synced_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS unit_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_item_id INTEGER REFERENCES inbound_line_items(id) ON DELETE SET NULL,
    demand_id INTEGER REFERENCES open_demand(id) ON DELETE SET NULL,
    intent_source_id INTEGER REFERENCES inbound_line_item_sources(id) ON DELETE SET NULL,
    quantity REAL NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('auto', 'manual')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'cancelled')),
    cw_pick_status TEXT CHECK (cw_pick_status IN ('ok', 'failed', 'skipped')),
    destination_company_id INTEGER,
    destination_ticket_id INTEGER,
    destination_project_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_unit_assignments_line_item ON unit_assignments(line_item_id);

  CREATE TABLE IF NOT EXISTS allocation_swaps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_a_id INTEGER NOT NULL REFERENCES unit_assignments(id),
    assignment_b_id INTEGER NOT NULL REFERENCES unit_assignments(id),
    snapshot_before TEXT NOT NULL, -- JSON
    snapshot_after TEXT NOT NULL,  -- JSON
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS receiving_sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1), -- single row
    last_started_at TEXT,
    last_success_at TEXT,
    last_error TEXT,
    running INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO receiving_sync_state (id, running) VALUES (1, 0);

  -- updated_at triggers, mirroring LC's own (shipments, unit_assignments)
  CREATE TRIGGER IF NOT EXISTS trg_shipments_updated_at
    AFTER UPDATE ON shipments
    BEGIN
      UPDATE shipments SET updated_at = datetime('now') WHERE id = NEW.id;
    END;
  CREATE TRIGGER IF NOT EXISTS trg_unit_assignments_updated_at
    AFTER UPDATE ON unit_assignments
    BEGIN
      UPDATE unit_assignments SET updated_at = datetime('now') WHERE id = NEW.id;
    END;
`;

const connections = new Map<string, Database.Database>();

/**
 * Lazily open (and cache) the SQLite connection for one CW instance's data.
 * Concurrent-safe across instances -- each instance is a genuinely separate
 * file/connection, so production and sandbox never contend with each other.
 */
export function getInstanceDb(instanceId: string): Database.Database {
  const existing = connections.get(instanceId);
  if (existing) return existing;

  const conn = new Database(join(DATA_DIR, `cast_${instanceId}.db`));
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.exec(INSTANCE_SCHEMA_SQL);

  // Migrate pre-existing container_items tables (created before INIT-0026
  // Phase 3 added the plain `description` column, distinct from
  // `description_override`) to add it now -- matches store/db.ts's own
  // ALTER-TABLE-guard convention.
  const cols = (conn.prepare("PRAGMA table_info(container_items)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("description")) conn.exec("ALTER TABLE container_items ADD COLUMN description TEXT");

  connections.set(instanceId, conn);
  return conn;
}

/** Test/shutdown helper -- closes and forgets a cached connection. */
export function closeInstanceDb(instanceId: string): void {
  const conn = connections.get(instanceId);
  if (conn) {
    conn.close();
    connections.delete(instanceId);
  }
}
