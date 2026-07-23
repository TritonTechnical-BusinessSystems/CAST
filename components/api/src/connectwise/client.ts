/**
 * ConnectWise client boundary (INIT-0014 / INIT-0002).
 *
 * CAST's first *write* into ConnectWise goes through this interface. Real CW API
 * credentials don't exist yet, so `getCwClient()` returns an in-memory stub; when
 * keys are issued, a `ManageCwClient` (CW PSA REST) implements the same interface
 * and the swap is a one-line change. CW credentials will live server-side only
 * (knowledge/decisions/0002) — never in the SPA, never in the browser.
 */

import { resolveCwCreds } from "./creds";
import { ManageCwClient } from "./manageClient";

export interface VesselCompany {
  /** ConnectWise company id. */
  id: string;
  /** The CW company (owning entity / client). */
  companyName: string;
  /** The vessel/yacht name. */
  vesselName: string;
  /** CW company status — scopes which companies are "tracked" (INIT-0012). */
  status: string;
  /** IMO number custom field (may be absent). */
  imo: string | null;
  /** MMSI custom field — added 2026-07-23; the field most often missing. */
  mmsi: string | null;
}

export interface CwClient {
  /** The vessel-client companies we track (CW status-scoped). */
  listTrackedVessels(): Promise<VesselCompany[]>;
  /** Write back IMO and/or MMSI custom fields for one company. */
  setVesselIdentifiers(id: string, patch: { imo?: string; mmsi?: string }): Promise<VesselCompany>;
}

/**
 * In-memory stand-in for CW until real API keys land. Data is illustrative
 * superyachts, deliberately seeded with the real-world gaps this tool exists to
 * fix: has-IMO-missing-MMSI (the common case), a typo'd IMO (invalid check
 * digit), and missing-both. IMO values are check-digit-valid so validation
 * doesn't reject the stub's own good rows.
 */
export class StubCwClient implements CwClient {
  private rows: VesselCompany[] = [
    { id: "1001", companyName: "Serene Waters Ltd", vesselName: "M/Y Serene Horizon", status: "Active", imo: "9074729", mmsi: null },
    { id: "1002", companyName: "Blue Meridian Holdings", vesselName: "M/Y Blue Meridian", status: "Active", imo: "9245677", mmsi: "319000456" },
    { id: "1003", companyName: "Azure Crown Yachting", vesselName: "M/Y Azure Crown", status: "Active", imo: "9311220", mmsi: null },
    { id: "1004", companyName: "Nautilus Charter Group", vesselName: "M/Y Nautilus Dream", status: "Active", imo: "9074720", mmsi: "538070123" },
    { id: "1005", companyName: "Windward Isle Marine", vesselName: "M/Y Windward", status: "Active", imo: null, mmsi: null },
    { id: "1006", companyName: "Crest Voyager Ltd", vesselName: "M/Y Crest Voyager", status: "Active", imo: "9632181", mmsi: "256001234" },
  ];

  async listTrackedVessels(): Promise<VesselCompany[]> {
    return this.rows.map((r) => ({ ...r }));
  }

  async setVesselIdentifiers(id: string, patch: { imo?: string; mmsi?: string }): Promise<VesselCompany> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`No tracked vessel with id ${id}`);
    if (patch.imo !== undefined) row.imo = patch.imo;
    if (patch.mmsi !== undefined) row.mmsi = patch.mmsi;
    return { ...row };
  }
}

let stub: CwClient | null = null;
let manage: CwClient | null = null;

/**
 * The active CW client: the live `ManageCwClient` when credentials resolve (env
 * or the encrypted store), otherwise the in-memory stub. Writes remain gated by
 * config.cwWritesEnabled inside ManageCwClient regardless.
 */
export function getCwClient(): CwClient {
  if (resolveCwCreds().creds) {
    if (!manage) manage = new ManageCwClient();
    return manage;
  }
  if (!stub) stub = new StubCwClient();
  return stub;
}
