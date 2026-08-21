/**
 * CW-instance registry (INIT-0026's Logistics rebuild, multi-instance
 * architecture). Metadata only (id/display-name) -- lives in `cast.db`'s
 * `cw_instances` table (seeded in `store/db.ts`). Credentials are a separate
 * concern, see `creds.ts`'s per-instance functions.
 *
 * No notion of a "default" instance is exposed here (removed 2026-08-20,
 * user: "There should be no default. Either it's explicitly working with
 * Production, or it's working with Sandbox. No automatic failover or default
 * assumption. We cannot risk it writing to a database it shouldn't.") The
 * underlying `is_default` DB column is left in place (unread) rather than
 * risk a schema migration against production for a column nothing consumes.
 */
import { db } from "../store/db";

export interface CwInstance {
  id: string;
  name: string;
}

interface CwInstanceRow {
  id: string;
  name: string;
}

export function listCwInstances(): CwInstance[] {
  const rows = db.prepare("SELECT id, name FROM cw_instances ORDER BY name").all() as CwInstanceRow[];
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

/** Throws if the instance id isn't registered -- callers should never silently fall through to the wrong instance's data. */
export function assertValidCwInstance(instanceId: string): void {
  const row = db.prepare("SELECT 1 FROM cw_instances WHERE id = ?").get(instanceId);
  if (!row) throw new Error(`Unknown CW instance "${instanceId}"`);
}
