/**
 * ConnectWise PSA (Manage) REST client — live implementation of CwClient.
 * Auth/base-URL/custom-field pattern mirrors LogisticsCoordinator's proven
 * integration (knowledge/architecture/connectwise-api-integration.md).
 *
 * SAFETY: every write checks isCwWritesEnabledForInstance() for ITS OWN
 * instance and refuses otherwise — the user gate, toggleable per instance
 * in-app (Integrations page, 2026-08-20: no longer a single global switch,
 * since that meant enabling writes to test against Sandbox also silently
 * enabled real writes to Production). Reads are always allowed.
 */
import { config, isCwWritesEnabledForInstance } from "../config";
import { resolveCwCredsForInstance, type CwCreds } from "./creds";
import type { CwClient, CwSite, VesselCompany, ShippingRequestTicket, ShipmentTicketDetail, CwBoardStatus, CwCurrencyOption } from "./client";

function authHeaders(c: CwCreds): Record<string, string> {
  const token = Buffer.from(`${c.company}+${c.publicKey}:${c.privateKey}`).toString("base64");
  return { Authorization: `Basic ${token}`, clientId: c.clientId, "Content-Type": "application/json", Accept: "application/json" };
}

// `creds` is REQUIRED (2026-08-19, user: "not comfortable with a fallback at
// all for database access/reads/writes... if something goes wrong and we
// fallback to the wrong database, especially the Production one, we're
// causing real damage to data"). Every call site must resolve its own
// instance's creds explicitly and pass them in — no implicit legacy/default
// lookup exists anywhere in this file anymore.
async function cwFetch<T>(path: string, init: RequestInit & { creds: CwCreds }): Promise<T> {
  const { creds } = init;
  const res = await fetch(`${creds.baseUrl}${path}`, {
    ...init,
    headers: { ...authHeaders(creds), ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`CW ${res.status}: ${body.slice(0, 200)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface CwCustomField { id: number; caption: string; value: unknown; }
interface CwCompany { id: number; name: string; identifier?: string; status?: { name?: string }; customFields?: CwCustomField[]; }

function fieldValue(c: CwCompany, caption: string): string | null {
  const f = c.customFields?.find((x) => x.caption === caption);
  const v = f?.value;
  return v == null || v === "" ? null : String(v);
}

function toVessel(c: CwCompany): VesselCompany {
  return {
    id: String(c.id),
    companyName: c.name,
    vesselName: c.name, // the CW company represents the vessel; no separate vessel-name field confirmed
    status: c.status?.name ?? "",
    imo: fieldValue(c, config.cwImoFieldCaption),
    mmsi: fieldValue(c, config.cwMmsiFieldCaption),
  };
}

/** Cheap connectivity/auth check (used by Integrations "Test connection"). */
export async function getSystemInfo(creds: CwCreds): Promise<{ version: string }> {
  return cwFetch<{ version: string }>("/system/info", { creds });
}

/** Alphabetical, for the Tracking Config option lists — not CW's native (id) order. */
function sortNames(names: string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Active only — CW marks retired statuses/boards inactiveFlag=true rather than deleting them. */
export async function listCompanyStatuses(creds: CwCreds): Promise<string[]> {
  const rows = await cwFetch<{ name: string; inactiveFlag?: boolean }[]>(
    "/company/companies/statuses?pageSize=200&fields=id,name,inactiveFlag",
    { creds },
  );
  return sortNames(rows.filter((r) => !r.inactiveFlag).map((r) => r.name));
}

interface CwBoardRow { name: string; department?: { name?: string }; inactiveFlag?: boolean }

async function listAllBoards(creds: CwCreds): Promise<CwBoardRow[]> {
  return cwFetch<CwBoardRow[]>("/service/boards?pageSize=200&fields=id,name,department,inactiveFlag", { creds });
}

/**
 * Active, non-Admin-department service boards (verified live 2026-08-11: CW
 * boards carry a `department` object — e.g. board "Admin" itself and
 * "Triton Management" are both `department.name === "Admin"` — and an
 * `inactiveFlag`, currently true for two retired example boards). Internal
 * admin work and retired boards aren't vessel-tracking priority signals.
 */
export async function listServiceBoards(creds: CwCreds): Promise<string[]> {
  const rows = await listAllBoards(creds);
  return sortNames(rows.filter((r) => !r.inactiveFlag && r.department?.name !== "Admin").map((r) => r.name));
}

/**
 * Names of active boards assigned to the "Admin" department — used to keep
 * Admin work out of the Project-activity signal too (2026-08-11, user:
 * "Same goes for Project Boards"). A CW Project has its own `board` field
 * (the same Service Board records), verified live; `board/department/name`
 * isn't a recognized condition path (400), but `board/name not in (...)` is.
 */
async function listAdminBoardNames(creds: CwCreds): Promise<string[]> {
  const rows = await listAllBoards(creds);
  return rows.filter((r) => !r.inactiveFlag && r.department?.name === "Admin").map((r) => r.name);
}

/** CW Project statuses (e.g. "1: Active", "5: Closed"), active only — parallel to listCompanyStatuses. */
export async function listProjectStatuses(creds: CwCreds): Promise<string[]> {
  const rows = await cwFetch<{ name: string; inactiveFlag?: boolean }[]>(
    "/project/statuses?pageSize=200&fields=id,name,inactiveFlag",
    { creds },
  );
  return sortNames(rows.filter((r) => !r.inactiveFlag).map((r) => r.name));
}

/**
 * CW Purchase Order statuses (e.g. "🔶 New", "✅ Received In Full"), active
 * only — INIT-0026 Phase 1's Receiving config. Requires the Procurement →
 * Purchase Order Statuses security-role grant confirmed during INIT-0018's
 * research; surfaces as a plain 403 from cwFetch if the API member lacks it
 * (no special-cased error message here, matching every other list* function
 * in this file — the route handler can add a friendlier message if needed).
 */
export async function listPurchaseOrderStatuses(creds: CwCreds): Promise<string[]> {
  const rows = await cwFetch<{ name: string; inactiveFlag?: boolean }[]>(
    "/procurement/purchaseorderstatuses?pageSize=200&fields=id,name,inactiveFlag",
    { creds },
  );
  return sortNames(rows.filter((r) => !r.inactiveFlag).map((r) => r.name));
}

interface CwUserDefinedFieldOption {
  optionValue: string;
  inactiveFlag?: boolean;
  sortOrder?: number;
}
interface CwUserDefinedField {
  id: number;
  options?: CwUserDefinedFieldOption[];
}

/**
 * Carrier picklist, live from the SAME CW ticket custom field
 * `Shipment Carrier` (id 70, INIT-0018) already used for outbound tracking —
 * replaces the old locally-managed `logistics_carriers` table (INIT-0026,
 * 2026-08-19: "need to be a live lookup of our Carriers custom field").
 * There's no dedicated "custom field definitions" REST resource in CW's API
 * (verified live — /system/customFields 404s); the real endpoint is
 * `/system/userDefinedFields`, the same one CW's own admin screen calls it
 * ("System > Setup Tables > Custom Fields"). Caption is configurable
 * (`config.cwCarrierFieldCaption`) — LC's own history shows this exact field
 * got renamed once in production already (a hardcoded caption silently broke
 * until caught).
 */
export async function listCarrierOptions(creds: CwCreds): Promise<string[]> {
  const rows = await cwFetch<CwUserDefinedField[]>(
    `/system/userDefinedFields?conditions=${encodeURIComponent(`caption="${config.cwCarrierFieldCaption}"`)}`,
    { creds },
  );
  const options = rows[0]?.options ?? [];
  return options
    .filter((o) => !o.inactiveFlag)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((o) => o.optionValue);
}

/**
 * Currency list, live from CW's Finance > Currencies setup — replaces the
 * old locally-managed `logistics_currencies` table (INIT-0026, 2026-08-19).
 * Requires a Finance-module read grant on the CW API member; if that grant
 * is missing this surfaces as a plain 403 from cwFetch (verified live,
 * 2026-08-19 — confirmed the endpoint itself is `/finance/currencies`, not a
 * 404, so this is a permission gap to close in ConnectWise, not a wrong
 * path), matching every other list* function in this file.
 */
export async function listCurrencyOptions(creds: CwCreds): Promise<CwCurrencyOption[]> {
  const rows = await cwFetch<{ isoCode: string; name: string }[]>("/finance/currencies?pageSize=200&fields=isoCode,name", { creds });
  return rows.map((r) => ({ code: r.isoCode, name: r.name })).sort((a, b) => a.code.localeCompare(b.code));
}

/** CW members — the source of truth for who the extension check-ins belong to. */
/**
 * Active, real member USERS only — the people who could run the extension.
 * `/system/members` returns both people and integration/API accounts (CPQ, RMM,
 * BrightGauge, app_CAST, …); the CW-native separator is `licenseClass`: "F" (Full)
 * = real members, "A" (API) = integration accounts. So we filter
 * `licenseClass="F"` (verified live: 99 F people vs 15 A API accounts) plus
 * `inactiveFlag=false` to drop disabled accounts.
 */
export async function listMembers(creds: CwCreds): Promise<{ identifier: string; name: string }[]> {
  const rows = await cwFetch<{ id: number; identifier?: string; firstName?: string; lastName?: string }[]>(
    // conditions=inactiveFlag=false AND licenseClass="F" (URL-encoded; cwFetch sends the path raw)
    '/system/members?pageSize=1000&conditions=inactiveFlag%3Dfalse%20AND%20licenseClass%3D%22F%22&fields=id,identifier,firstName,lastName',
    { creds },
  );
  return rows.map((r) => ({
    identifier: r.identifier ?? String(r.id),
    name: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.identifier || String(r.id),
  }));
}

interface CwActivityRow { company?: { id: number }; _info?: { lastUpdated?: string } }

/** Merge one page's rows into a company->latest-activity map (keeps the max). */
function mergeActivity(into: Map<string, string>, rows: CwActivityRow[]): void {
  for (const r of rows) {
    const id = r.company?.id;
    const ts = r._info?.lastUpdated;
    if (id == null || !ts) continue;
    const key = String(id);
    const existing = into.get(key);
    if (!existing || new Date(ts) > new Date(existing)) into.set(key, ts);
  }
}

/**
 * Company id -> most recent activity timestamp among its open service
 * tickets on any of the given boards. `board/name in (...)` verified live
 * against real CW (2026-08) to handle special characters (emoji board names)
 * fine; `_info.lastUpdated` verified present on every ticket row.
 */
async function queryOpenTicketActivity(boardNames: string[], creds: CwCreds): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (boardNames.length === 0) return out;
  const boardList = boardNames.map((b) => `"${b.replace(/"/g, '\\"')}"`).join(",");
  const conditions = `board/name in (${boardList}) AND closedFlag=false`;
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({ pageSize: "1000", page: String(page), conditions, fields: "company,_info" });
    const batch = await cwFetch<CwActivityRow[]>(`/service/tickets?${params.toString()}`, { creds });
    mergeActivity(out, batch);
    if (batch.length < 1000) break;
  }
  return out;
}

/**
 * Company id -> most recent activity timestamp among its open CW Projects
 * (real Project module, `/project/projects` — confirmed live to exist and
 * carry `_info.lastUpdated` the same as tickets) in any of the given
 * statuses. This is the Tier-1 priority signal that unconditionally
 * outranks the ticket signal above. Projects on an "Admin"-department board
 * are excluded, same as Admin boards are excluded from ticket tracking.
 */
async function queryOpenProjectActivity(statusNames: string[], creds: CwCreds): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (statusNames.length === 0) return out;
  const statusList = statusNames.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(",");
  let conditions = `status/name in (${statusList}) AND closedFlag=false`;
  const adminBoards = await listAdminBoardNames(creds);
  if (adminBoards.length > 0) {
    const adminBoardList = adminBoards.map((b) => `"${b.replace(/"/g, '\\"')}"`).join(",");
    conditions += ` AND board/name not in (${adminBoardList})`;
  }
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({ pageSize: "1000", page: String(page), conditions, fields: "company,_info" });
    const batch = await cwFetch<CwActivityRow[]>(`/project/projects?${params.toString()}`, { creds });
    mergeActivity(out, batch);
    if (batch.length < 1000) break;
  }
  return out;
}

async function queryCompanies(creds: CwCreds, conditions?: string): Promise<CwCompany[]> {
  const out: CwCompany[] = [];
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({ pageSize: "1000", page: String(page), fields: "id,name,identifier,status,customFields" });
    if (conditions) params.set("conditions", conditions);
    const batch = await cwFetch<CwCompany[]>(`/company/companies?${params.toString()}`, { creds });
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

/**
 * Default CW ticket filter for "Outbound Shipments" (INIT-0026 Phase 2),
 * ported verbatim from LC's own fallback (`ConfigPage.jsx`'s per-instance
 * `ticket_filter`, else this default). LC lets this be overridden per CW
 * instance; CAST defers that configurability rather than re-opening Phase 1
 * — see the Phase 2 review notes.
 */
const DEFAULT_SHIPPING_REQUEST_FILTER = 'closedFlag=false AND type/name="Logistics" AND subType/name="Shipping Request"';
const SHIPPING_REQUEST_FIELDS = "id,summary,company,status,requiredDate";

interface CwTicketRow {
  id: number;
  summary: string;
  company?: { id: number; name: string };
  status?: { id: number; name: string };
  board?: { id: number; name: string };
  site?: { id: number; name: string };
  requiredDate?: string;
  estimatedStartDate?: string;
}

function toShippingTicket(r: CwTicketRow, ticketType: "service" | "project"): ShippingRequestTicket {
  return {
    id: r.id,
    ticketType,
    summary: r.summary,
    companyId: r.company?.id ?? null,
    companyName: r.company?.name ?? "",
    statusId: r.status?.id ?? null,
    statusName: r.status?.name ?? "",
    requiredDate: r.requiredDate ?? null,
  };
}

async function queryTickets(path: string, conditions: string, fields: string, creds: CwCreds): Promise<CwTicketRow[]> {
  const out: CwTicketRow[] = [];
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({ pageSize: "200", page: String(page), conditions, fields });
    const batch = await cwFetch<CwTicketRow[]>(`${path}?${params.toString()}`, { creds });
    out.push(...batch);
    if (batch.length < 200) break;
  }
  return out;
}

/**
 * Merged, sorted Service + Project "Shipping Request" tickets — this IS the
 * Outbound Shipment list (INIT-0026 Phase 2), not a local-DB query; mirrors
 * LC's `get_shipping_requests()` exactly (two parallel CW calls, merge,
 * sort by id descending).
 */
async function listShippingRequestTickets(creds: CwCreds): Promise<ShippingRequestTicket[]> {
  const [service, project] = await Promise.all([
    queryTickets("/service/tickets", DEFAULT_SHIPPING_REQUEST_FILTER, SHIPPING_REQUEST_FIELDS, creds),
    queryTickets("/project/tickets", DEFAULT_SHIPPING_REQUEST_FILTER, SHIPPING_REQUEST_FIELDS, creds),
  ]);
  const tickets = [...service.map((r) => toShippingTicket(r, "service")), ...project.map((r) => toShippingTicket(r, "project"))];
  return tickets.sort((a, b) => b.id - a.id);
}

/**
 * Ticket id -> summed product quantity, via the `Outbound Shipment ID`
 * custom field on ticket-side Products (`/procurement/products`) — mirrors
 * LC's per-ticket-id sum exactly, run concurrently rather than serially
 * (safe perf improvement, same query shape/semantics per ticket).
 */
async function getShippingRequestProductCounts(ticketIds: number[], creds: CwCreds): Promise<Map<number, number>> {
  const entries = await Promise.all(
    ticketIds.map(async (id): Promise<[number, number]> => {
      let total = 0;
      for (let page = 1; ; page++) {
        const params = new URLSearchParams({
          pageSize: "1000",
          page: String(page),
          customFieldConditions: `caption="Outbound Shipment ID" AND value=${id}`,
          fields: "quantity",
        });
        const batch = await cwFetch<{ quantity?: number }[]>(`/procurement/products?${params.toString()}`, { creds });
        total += batch.reduce((sum, r) => sum + (r.quantity ?? 0), 0);
        if (batch.length < 1000) break;
      }
      return [id, total];
    }),
  );
  return new Map(entries);
}

async function fetchTicketDetail(path: string, id: number, creds: CwCreds): Promise<CwTicketRow | null> {
  try {
    return await cwFetch<CwTicketRow>(
      `${path}/${id}?fields=id,summary,company,status,board,site,requiredDate,estimatedStartDate`,
      { creds },
    );
  } catch (e) {
    if (e instanceof Error && /^CW 404/.test(e.message)) return null;
    throw e;
  }
}

/**
 * Full ticket read for the Shipment detail shell's header — tries Service
 * then Project (a shipping-request ticket ID isn't self-describing about
 * which module it's in), matching how a shipment's local row is looked up
 * by CW ticket id with no separate type marker stored.
 */
async function getShipmentTicket(ticketId: number, creds: CwCreds): Promise<ShipmentTicketDetail | null> {
  const service = await fetchTicketDetail("/service/tickets", ticketId, creds);
  const [row, ticketType] = service ? [service, "service" as const] : [await fetchTicketDetail("/project/tickets", ticketId, creds), "project" as const];
  if (!row) return null;
  return {
    ...toShippingTicket(row, ticketType),
    boardId: row.board?.id ?? null,
    boardName: row.board?.name ?? null,
    siteName: row.site?.name ?? null,
    estimatedStartDate: row.estimatedStartDate ?? null,
  };
}

/** Active statuses for a board — boards are shared between service/project tickets, so one lookup covers both. */
async function listBoardStatuses(boardId: number, creds: CwCreds): Promise<CwBoardStatus[]> {
  const rows = await cwFetch<{ id: number; name: string; inactiveFlag?: boolean }[]>(
    `/service/boards/${boardId}/statuses?pageSize=200&fields=id,name,inactiveFlag`,
    { creds },
  );
  return rows.filter((r) => !r.inactiveFlag).map((r) => ({ id: r.id, name: r.name }));
}

/**
 * Attaches a PDF to a CW ticket's Documents tab (`POST /system/documents`,
 * multipart) — ported from LC's `cw_client.upload_document` exactly (same
 * `recordId`/`recordType: "Ticket"`/`title`/`isPrivate: "false"` fields).
 * Doesn't reuse `cwFetch`: that helper always sends `Content-Type:
 * application/json` and JSON-encodes the body, neither of which applies to
 * a multipart upload (the browser/runtime must set its own boundary).
 */
async function uploadTicketDocument(ticketId: number, pdfBytes: Buffer, filename: string, title: string, creds: CwCreds): Promise<number> {
  const c = creds;
  const token = Buffer.from(`${c.company}+${c.publicKey}:${c.privateKey}`).toString("base64");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" }), filename);
  form.append("recordId", String(ticketId));
  form.append("recordType", "Ticket");
  form.append("title", title);
  form.append("isPrivate", "false");
  const res = await fetch(`${c.baseUrl}/system/documents`, {
    method: "POST",
    headers: { Authorization: `Basic ${token}`, clientId: c.clientId, Accept: "application/json" },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`CW ${res.status}: ${body.slice(0, 200)}`);
  }
  const created = (await res.json()) as { id: number };
  return created.id;
}

/** Writes the CW ticket's own status (distinct from and unrelated to the local shipment record's `status` column). */
async function updateTicketStatus(ticketId: number, ticketType: "service" | "project", statusId: number, creds: CwCreds): Promise<void> {
  const path = ticketType === "service" ? "/service/tickets" : "/project/tickets";
  await cwFetch(`${path}/${ticketId}`, {
    method: "PATCH",
    body: JSON.stringify([{ op: "replace", path: "/status", value: { id: statusId } }]),
    creds,
  });
}

export class ManageCwClient implements CwClient {
  /**
   * `instanceId` is REQUIRED — every caller must say which CW company
   * ("tritontech"/Production, "tritontech_cs1"/Sandbox, ...) it means. There
   * is no legacy/default no-instance mode anymore (removed 2026-08-19, user:
   * "not comfortable with a fallback at all ... if something goes wrong and
   * we fallback to the wrong database, especially the Production one, we're
   * causing real damage to data"). `creds()` below is the hard safety
   * boundary this depends on: an instance with no configured credentials
   * throws loudly rather than silently falling back to any other instance's
   * creds — structurally impossible for a Sandbox-scoped request to
   * accidentally read or write Production (or vice versa).
   */
  constructor(private readonly instanceId: string) {}

  private creds(): CwCreds {
    const { creds } = resolveCwCredsForInstance(this.instanceId);
    if (!creds) throw new Error(`ConnectWise is not configured for instance "${this.instanceId}"`);
    return creds;
  }

  async listTrackedVessels(): Promise<VesselCompany[]> {
    // A vessel = any company whose Market contains the configured value (e.g.
    // "🛳️ Yacht"), regardless of IMO/MMSI — so vessels missing an identifier
    // still surface for reconciliation. Optional status further scopes it.
    const parts = [`market/name contains "${config.cwVesselMarket}"`];
    if (config.cwTrackedStatus) parts.push(`status/name="${config.cwTrackedStatus}"`);
    const companies = await queryCompanies(this.creds(), parts.join(" AND "));
    return companies.map(toVessel);
  }

  async setVesselIdentifiers(id: string, patch: { imo?: string; mmsi?: string }): Promise<VesselCompany> {
    if (!isCwWritesEnabledForInstance(this.instanceId)) {
      throw new Error("ConnectWise writes are disabled (safety gate). Enable them on the Integrations page.");
    }
    const creds = this.creds();
    // CW requires the WHOLE customFields array on PATCH — GET, splice, PATCH back.
    const company = await cwFetch<CwCompany>(`/company/companies/${id}?fields=id,name,status,customFields`, { creds });
    const fields = (company.customFields ?? []).map((f) => ({ ...f }));
    const setField = (caption: string, value: string) => {
      const f = fields.find((x) => x.caption === caption);
      if (f) f.value = value;
    };
    if (patch.imo !== undefined) setField(config.cwImoFieldCaption, patch.imo);
    if (patch.mmsi !== undefined) setField(config.cwMmsiFieldCaption, patch.mmsi);
    const updated = await cwFetch<CwCompany>(`/company/companies/${id}`, {
      method: "PATCH",
      body: JSON.stringify([{ op: "replace", path: "/customFields", value: fields }]),
      creds,
    });
    return toVessel(updated);
  }

  async listOpenTicketActivity(boardNames: string[]): Promise<Map<string, string>> {
    return queryOpenTicketActivity(boardNames, this.creds());
  }

  async listOpenProjectActivity(statusNames: string[]): Promise<Map<string, string>> {
    return queryOpenProjectActivity(statusNames, this.creds());
  }

  async getCompanySites(companyId: string): Promise<CwSite[]> {
    const rows = await cwFetch<{ id: number; name: string; inactiveFlag?: boolean }[]>(
      `/company/companies/${companyId}/sites?pageSize=50&fields=id,name,inactiveFlag`,
      { creds: this.creds() },
    );
    return rows.map((r) => ({ id: String(r.id), name: r.name, inactive: Boolean(r.inactiveFlag) }));
  }

  /**
   * Minimal payload verified live (2026-08-11) against a real existing
   * "Vessel" site record — `addressLine1` is the placeholder copy CW already
   * uses for a not-yet-located vessel. taxCode/territory/timeZone were
   * present on the sample but left unset here; if CW rejects an omission as
   * required, the error surfaces in the tier-refresh job's logs (non-
   * destructive — it just retries next cycle) and can be added then.
   */
  async createVesselSite(companyId: string): Promise<CwSite> {
    if (!isCwWritesEnabledForInstance(this.instanceId)) {
      throw new Error("ConnectWise writes are disabled (safety gate). Enable them on the Integrations page.");
    }
    const created = await cwFetch<{ id: number; name: string; inactiveFlag?: boolean }>(
      `/company/companies/${companyId}/sites`,
      {
        method: "POST",
        body: JSON.stringify({ name: "Vessel", addressLine1: "(Vessel's current location unknown)" }),
        creds: this.creds(),
      },
    );
    return { id: String(created.id), name: created.name, inactive: Boolean(created.inactiveFlag) };
  }

  async updateVesselSite(
    companyId: string,
    siteId: string,
    patch: { name?: string; addressLine1?: string; timeZoneSetupId?: number; lastAisUpdateText?: string },
  ): Promise<void> {
    if (!isCwWritesEnabledForInstance(this.instanceId)) {
      throw new Error("ConnectWise writes are disabled (safety gate). Enable them on the Integrations page.");
    }
    const creds = this.creds();
    const ops: { op: "replace"; path: string; value: unknown }[] = [];
    if (patch.name !== undefined) ops.push({ op: "replace", path: "/name", value: patch.name });
    if (patch.addressLine1 !== undefined) ops.push({ op: "replace", path: "/addressLine1", value: patch.addressLine1 });
    if (patch.timeZoneSetupId !== undefined) ops.push({ op: "replace", path: "/timeZone", value: { id: patch.timeZoneSetupId } });
    if (ops.length > 0) {
      await cwFetch(`/company/companies/${companyId}/sites/${siteId}`, {
        method: "PATCH",
        body: JSON.stringify(ops),
        creds,
      });
    }

    // Custom field, so it needs its own GET-splice-PATCH round trip — same
    // pattern as setVesselIdentifiers's company customFields write, just
    // scoped to the Site's own (much smaller) customFields array.
    if (patch.lastAisUpdateText !== undefined) {
      const site = await cwFetch<{ customFields?: CwCustomField[] }>(
        `/company/companies/${companyId}/sites/${siteId}?fields=customFields`,
        { creds },
      );
      const fields = (site.customFields ?? []).map((f) => ({ ...f }));
      const field = fields.find((f) => f.caption === config.cwLastAisUpdateFieldCaption);
      if (field) {
        field.value = patch.lastAisUpdateText;
        await cwFetch(`/company/companies/${companyId}/sites/${siteId}`, {
          method: "PATCH",
          body: JSON.stringify([{ op: "replace", path: "/customFields", value: fields }]),
          creds,
        });
      } else {
        // Was a silent no-op — if the CW field ever gets renamed, freshness
        // reporting would stop with nothing to notice it by (flagged in the
        // v0.11.0 security review as an operational blind spot).
        console.warn(
          `[connectwise] Site ${siteId} (company ${companyId}) has no custom field captioned "${config.cwLastAisUpdateFieldCaption}" — "Last AIS Data Update" write skipped.`,
        );
      }
    }
  }

  // Calls the module-level function of the same name above (not a recursive
  // self-call) — unlike this file's other list*/query* pairs, this one has
  // no separate module-level name since there's no other caller for it yet.
  async listPurchaseOrderStatuses(): Promise<string[]> {
    return listPurchaseOrderStatuses(this.creds());
  }

  async listCarrierOptions(): Promise<string[]> {
    return listCarrierOptions(this.creds());
  }

  async listCurrencyOptions(): Promise<CwCurrencyOption[]> {
    return listCurrencyOptions(this.creds());
  }

  async listShippingRequestTickets(): Promise<ShippingRequestTicket[]> {
    return listShippingRequestTickets(this.creds());
  }

  async getShippingRequestProductCounts(ticketIds: number[]): Promise<Map<number, number>> {
    return getShippingRequestProductCounts(ticketIds, this.creds());
  }

  async getShipmentTicket(ticketId: number): Promise<ShipmentTicketDetail | null> {
    return getShipmentTicket(ticketId, this.creds());
  }

  async listBoardStatuses(boardId: number): Promise<CwBoardStatus[]> {
    return listBoardStatuses(boardId, this.creds());
  }

  async updateTicketStatus(ticketId: number, ticketType: "service" | "project", statusId: number): Promise<void> {
    if (!isCwWritesEnabledForInstance(this.instanceId)) {
      throw new Error("ConnectWise writes are disabled (safety gate). Enable them on the Integrations page.");
    }
    return updateTicketStatus(ticketId, ticketType, statusId, this.creds());
  }

  async uploadTicketDocument(ticketId: number, pdfBytes: Buffer, filename: string, title: string): Promise<number> {
    if (!isCwWritesEnabledForInstance(this.instanceId)) {
      throw new Error("ConnectWise writes are disabled (safety gate). Enable them on the Integrations page.");
    }
    return uploadTicketDocument(ticketId, pdfBytes, filename, title, this.creds());
  }
}
