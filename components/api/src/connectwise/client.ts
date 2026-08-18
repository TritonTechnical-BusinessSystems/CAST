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

/** A CW Service or Project ticket that matches the Shipping Request filter (INIT-0026 Phase 2). */
export interface ShippingRequestTicket {
  id: number;
  ticketType: "service" | "project";
  summary: string;
  companyId: number | null;
  companyName: string;
  statusId: number | null;
  statusName: string;
  requiredDate: string | null;
}

/** The fuller ticket read for the Shipment detail shell's header. */
export interface ShipmentTicketDetail extends ShippingRequestTicket {
  boardId: number | null;
  boardName: string | null;
  siteName: string | null;
  estimatedStartDate: string | null;
}

export interface CwBoardStatus {
  id: number;
  name: string;
}

export interface CwClient {
  /** The vessel-client companies we track (CW status-scoped). */
  listTrackedVessels(): Promise<VesselCompany[]>;
  /** Write back IMO and/or MMSI custom fields for one company. */
  setVesselIdentifiers(id: string, patch: { imo?: string; mmsi?: string }): Promise<VesselCompany>;
  /**
   * Company id -> ISO timestamp of its most recent activity on an open
   * (unclosed) service ticket on any of the given boards (INIT-0015's "open
   * work" criterion; INIT-0012's Tier-2 priority signal, ranked by recency).
   */
  listOpenTicketActivity(boardNames: string[]): Promise<Map<string, string>>;
  /**
   * Company id -> ISO timestamp of its most recent activity on an open
   * (non-closed-status) CW Project in any of the given statuses. INIT-0012's
   * Tier-1 priority signal — unconditionally outranks the ticket signal.
   */
  listOpenProjectActivity(statusNames: string[]): Promise<Map<string, string>>;
  /** A company's CW sites — used to resolve its Vessel Site (INIT-0012). */
  getCompanySites(companyId: string): Promise<CwSite[]>;
  /**
   * Create the "Vessel" site for a company that doesn't have one yet —
   * self-heals a missing write target instead of leaving the vessel
   * permanently excluded from AIS tracking. Gated by isCwWritesEnabled()
   * like every other CW write.
   */
  createVesselSite(companyId: string): Promise<CwSite>;
  /**
   * Write the current status/position onto an already-resolved Vessel Site
   * (redesigned 2026-08-17 — see vessels/siteWriter.ts for the full field
   * spec): `name` = confidence-colored friendly status + place/destination
   * (e.g. "🟢 Vessel docked in La Ciotat, France"), `addressLine1` = raw
   * comma-joined decimal coordinates, `timeZoneSetupId` = a
   * `/system/timeZoneSetups` reference id, `lastAisUpdateText` = the "Last
   * AIS Data Update" custom field. `addressLine1`/`timeZoneSetupId` omitted
   * (not overwritten) once confidence has fully expired. Gated by
   * isCwWritesEnabled() like every other CW write.
   */
  updateVesselSite(
    companyId: string,
    siteId: string,
    patch: { name?: string; addressLine1?: string; timeZoneSetupId?: number; lastAisUpdateText?: string },
  ): Promise<void>;
  /**
   * Active CW Purchase Order statuses (INIT-0026 Phase 1, Logistics
   * Receiving config) — the live checkbox options for "which PO statuses
   * count as open," per company (ties to the `procurement/purchaseorderstatuses`
   * permission grant confirmed during INIT-0018's research).
   */
  listPurchaseOrderStatuses(): Promise<string[]>;
  /**
   * Live CW Service + Project tickets matching the Shipping Request filter
   * (INIT-0026 Phase 2's Outbound Shipment list — this IS the list; there is
   * no local "all shipments" table to page over, mirroring LC's own design).
   */
  listShippingRequestTickets(): Promise<ShippingRequestTicket[]>;
  /** Ticket id -> total product quantity tagged with that Outbound Shipment ID. */
  getShippingRequestProductCounts(ticketIds: number[]): Promise<Map<number, number>>;
  /** Full ticket read for the Shipment detail shell's header. Null if not found as either a service or project ticket. */
  getShipmentTicket(ticketId: number): Promise<ShipmentTicketDetail | null>;
  /** Active statuses for a board (shared between service/project tickets). */
  listBoardStatuses(boardId: number): Promise<CwBoardStatus[]>;
  /** Write the CW ticket's status (not the local shipment record's — see the detail shell's header dropdown). */
  updateTicketStatus(ticketId: number, ticketType: "service" | "project", statusId: number): Promise<void>;
  /** "Post to CW" (INIT-0026 Phase 3) — attaches a generated CI/PL PDF to the ticket's Documents tab. Returns the new CW document id. */
  uploadTicketDocument(ticketId: number, pdfBytes: Buffer, filename: string, title: string): Promise<number>;
}

export interface CwSite {
  id: string;
  name: string;
  inactive: boolean;
}

/** Merge company->timestamp maps, keeping the most recent per company. */
function mergeLatest(maps: Record<string, string>[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of maps) {
    for (const [id, ts] of Object.entries(m)) {
      const existing = out.get(id);
      if (!existing || new Date(ts) > new Date(existing)) out.set(id, ts);
    }
  }
  return out;
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

  // Illustrative: "Refit" board has open ticket work for two companies;
  // "Refit 2026" project status has open project work for one (which should
  // outrank the ticket-only companies once both signals are in play).
  private openTickets: Record<string, Record<string, string>> = {
    Refit: { "1002": "2026-08-01T10:00:00Z", "1006": "2026-08-05T14:30:00Z" },
  };
  private openProjects: Record<string, Record<string, string>> = {
    "Refit 2026": { "1004": "2026-08-10T09:00:00Z" },
  };

  async listOpenTicketActivity(boardNames: string[]): Promise<Map<string, string>> {
    return mergeLatest(boardNames.map((b) => this.openTickets[b] ?? {}));
  }

  async listOpenProjectActivity(statusNames: string[]): Promise<Map<string, string>> {
    return mergeLatest(statusNames.map((s) => this.openProjects[s] ?? {}));
  }

  // Illustrative: most have a "Vessel" site; 1005 has none (excludable), 1006
  // has its "Vessel" site inactive (also excludable until reactivated).
  private sites: Record<string, CwSite[]> = {
    "1001": [{ id: "s1001a", name: "Vessel", inactive: false }, { id: "s1001b", name: "Shoreside Office", inactive: false }],
    "1002": [{ id: "s1002a", name: "Vessel", inactive: false }],
    "1003": [{ id: "s1003a", name: "Vessel", inactive: false }],
    "1004": [{ id: "s1004a", name: "Vessel", inactive: false }],
    "1005": [{ id: "s1005a", name: "Shoreside Office", inactive: false }],
    "1006": [{ id: "s1006a", name: "Vessel", inactive: true }],
  };

  async getCompanySites(companyId: string): Promise<CwSite[]> {
    return (this.sites[companyId] ?? []).map((s) => ({ ...s }));
  }

  async createVesselSite(companyId: string): Promise<CwSite> {
    const site: CwSite = { id: `s${companyId}-created`, name: "Vessel", inactive: false };
    this.sites[companyId] = [...(this.sites[companyId] ?? []), site];
    return { ...site };
  }

  async updateVesselSite(
    companyId: string,
    siteId: string,
    patch: { name?: string; addressLine1?: string; timeZoneSetupId?: number; lastAisUpdateText?: string },
  ): Promise<void> {
    const site = (this.sites[companyId] ?? []).find((s) => s.id === siteId);
    if (site && patch.name !== undefined) site.name = patch.name;
  }

  async listPurchaseOrderStatuses(): Promise<string[]> {
    return ["New", "Sent to Vendor", "On Order", "Backordered", "Received In Full", "Cancelled"];
  }

  // Illustrative shipping-request tickets — one service, one project, so both
  // merge paths and both status-update ticket types have something to exercise.
  private shippingTickets: ShipmentTicketDetail[] = [
    {
      id: 40021,
      ticketType: "service",
      summary: "Refit parts — outbound to M/Y Serene Horizon",
      companyId: 1001,
      companyName: "Serene Waters Ltd",
      statusId: 1,
      statusName: "New",
      boardId: 501,
      boardName: "Logistics",
      siteName: "Vessel",
      requiredDate: "2026-08-20T00:00:00Z",
      estimatedStartDate: "2026-08-18T00:00:00Z",
    },
    {
      id: 40018,
      ticketType: "project",
      summary: "Refit 2026 — bulk hardware shipment",
      companyId: 1004,
      companyName: "Nautilus Charter Group",
      statusId: 2,
      statusName: "In Progress",
      boardId: 501,
      boardName: "Logistics",
      siteName: "Vessel",
      requiredDate: "2026-08-25T00:00:00Z",
      estimatedStartDate: null,
    },
  ];

  async listShippingRequestTickets(): Promise<ShippingRequestTicket[]> {
    return this.shippingTickets.map(({ id, ticketType, summary, companyId, companyName, statusId, statusName, requiredDate }) => ({
      id,
      ticketType,
      summary,
      companyId,
      companyName,
      statusId,
      statusName,
      requiredDate,
    }));
  }

  async getShippingRequestProductCounts(ticketIds: number[]): Promise<Map<number, number>> {
    const counts = new Map<number, number>([[40021, 12], [40018, 4]]);
    return new Map(ticketIds.map((id) => [id, counts.get(id) ?? 0]));
  }

  async getShipmentTicket(ticketId: number): Promise<ShipmentTicketDetail | null> {
    const t = this.shippingTickets.find((x) => x.id === ticketId);
    return t ? { ...t } : null;
  }

  async listBoardStatuses(): Promise<CwBoardStatus[]> {
    return [
      { id: 1, name: "New" },
      { id: 2, name: "In Progress" },
      { id: 3, name: "Ready to Ship" },
      { id: 4, name: "Shipped" },
    ];
  }

  async updateTicketStatus(ticketId: number, _ticketType: "service" | "project", statusId: number): Promise<void> {
    const t = this.shippingTickets.find((x) => x.id === ticketId);
    if (t) {
      const status = (await this.listBoardStatuses()).find((s) => s.id === statusId);
      if (status) {
        t.statusId = status.id;
        t.statusName = status.name;
      }
    }
  }

  private nextDocId = 9001;
  async uploadTicketDocument(): Promise<number> {
    return this.nextDocId++;
  }
}

let stub: CwClient | null = null;
let manage: CwClient | null = null;
const manageByInstance = new Map<string, CwClient>();

/**
 * The active CW client: the live `ManageCwClient` when credentials resolve (env
 * or the encrypted store), otherwise the in-memory stub. Writes remain gated by
 * isCwWritesEnabled() inside ManageCwClient regardless.
 *
 * `getCwClient()` (no args) is untouched — every existing caller (vessel
 * tracking, tracking sync) keeps today's exact single-instance behavior.
 * `getCwClient(instanceId)` is INIT-0026's multi-instance addition: one
 * lazily-created, cached client per instance, each bound to that instance's
 * own credentials via `ManageCwClient`'s constructor — never the stub
 * fallback, since an unconfigured named instance should surface as a loud
 * "not configured" error (from `ManageCwClient.creds()`), not silently
 * degrade to illustrative stub data the way the legacy no-instance path does.
 */
export function getCwClient(instanceId?: string): CwClient {
  if (instanceId) {
    let client = manageByInstance.get(instanceId);
    if (!client) {
      client = new ManageCwClient(instanceId);
      manageByInstance.set(instanceId, client);
    }
    return client;
  }
  if (resolveCwCreds().creds) {
    if (!manage) manage = new ManageCwClient();
    return manage;
  }
  if (!stub) stub = new StubCwClient();
  return stub;
}
