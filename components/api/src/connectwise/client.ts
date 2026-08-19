/**
 * ConnectWise client boundary (INIT-0014 / INIT-0002).
 *
 * CAST's write path into ConnectWise goes through this interface —
 * `ManageCwClient` (CW PSA REST) is the only implementation now that real
 * keys are issued for every real instance. CW credentials live server-side
 * only (knowledge/decisions/0002) — never in the SPA, never in the browser.
 */

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
  /** Live carrier picklist from the "Shipment Carrier" ticket custom field (INIT-0026, replaces the old locally-managed list). */
  listCarrierOptions(): Promise<string[]>;
  /** Live currency list from CW's Finance > Currencies setup (INIT-0026, replaces the old locally-managed list). */
  listCurrencyOptions(): Promise<CwCurrencyOption[]>;
}

export interface CwCurrencyOption {
  code: string;
  name: string;
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

const manageByInstance = new Map<string, CwClient>();

/**
 * `instanceId` is REQUIRED — no no-arg/default/stub mode anymore (removed
 * 2026-08-19, user: "not comfortable with a fallback at all ... if
 * something goes wrong and we fallback to the wrong database, especially
 * the Production one, we're causing real damage to data"). One lazily-
 * created, cached client per instance, each bound to that instance's own
 * credentials via `ManageCwClient`'s constructor. An unconfigured instance
 * surfaces as a loud "not configured" error (`ManageCwClient.creds()`), not
 * a silent illustrative-data or wrong-instance fallback.
 */
export function getCwClient(instanceId: string): CwClient {
  let client = manageByInstance.get(instanceId);
  if (!client) {
    client = new ManageCwClient(instanceId);
    manageByInstance.set(instanceId, client);
  }
  return client;
}
