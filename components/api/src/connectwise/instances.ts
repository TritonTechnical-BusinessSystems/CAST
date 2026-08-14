/**
 * CW-instance registry (INIT-0026's Logistics rebuild, multi-instance
 * architecture). Metadata only (id/display-name/default-flag) -- lives in
 * `cast.db`'s `cw_instances` table (seeded in `store/db.ts`). Credentials are
 * a separate concern, see `creds.ts`'s per-instance functions.
 */
import { db } from "../store/db";

export interface CwInstance {
  id: string;
  name: string;
  isDefault: boolean;
}

interface CwInstanceRow {
  id: string;
  name: string;
  is_default: number;
}

export function listCwInstances(): CwInstance[] {
  const rows = db.prepare("SELECT id, name, is_default FROM cw_instances ORDER BY is_default DESC, name").all() as CwInstanceRow[];
  return rows.map((r) => ({ id: r.id, name: r.name, isDefault: !!r.is_default }));
}

export function getDefaultCwInstanceId(): string {
  const row = db.prepare("SELECT id FROM cw_instances WHERE is_default = 1 LIMIT 1").get() as { id: string } | undefined;
  return row?.id ?? "tritontech";
}

/** Throws if the instance id isn't registered -- callers should never silently fall through to the wrong instance's data. */
export function assertValidCwInstance(instanceId: string): void {
  const row = db.prepare("SELECT 1 FROM cw_instances WHERE id = ?").get(instanceId);
  if (!row) throw new Error(`Unknown CW instance "${instanceId}"`);
}
