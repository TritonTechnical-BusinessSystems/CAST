/**
 * ConnectWise PSA (Manage) REST client — live implementation of CwClient.
 * Auth/base-URL/custom-field pattern mirrors LogisticsCoordinator's proven
 * integration (knowledge/architecture/connectwise-api-integration.md).
 *
 * SAFETY: every write checks isCwWritesEnabled() and refuses otherwise — the
 * user gate, toggleable in-app (Integrations page). Reads are always allowed.
 */
import { config, isCwWritesEnabled } from "../config";
import { resolveCwCreds, type CwCreds } from "./creds";
import type { CwClient, CwSite, VesselCompany } from "./client";

function authHeaders(c: CwCreds): Record<string, string> {
  const token = Buffer.from(`${c.company}+${c.publicKey}:${c.privateKey}`).toString("base64");
  return { Authorization: `Basic ${token}`, clientId: c.clientId, "Content-Type": "application/json", Accept: "application/json" };
}

async function cwFetch<T>(path: string, init?: RequestInit & { creds?: CwCreds }): Promise<T> {
  const creds = init?.creds ?? resolveCwCreds().creds;
  if (!creds) throw new Error("ConnectWise is not configured");
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
export async function getSystemInfo(creds?: CwCreds): Promise<{ version: string }> {
  return cwFetch<{ version: string }>("/system/info", { creds });
}

/** Alphabetical, for the Tracking Config option lists — not CW's native (id) order. */
function sortNames(names: string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export async function listCompanyStatuses(): Promise<string[]> {
  const rows = await cwFetch<{ name: string }[]>("/company/companies/statuses?pageSize=200&fields=id,name");
  return sortNames(rows.map((r) => r.name));
}

/**
 * Service boards, excluding any assigned to the "Admin" department (verified
 * live 2026-08-11: CW boards carry a `department` object, e.g. board "Admin"
 * itself and "Triton Management" are both `department.name === "Admin"`) —
 * internal admin work isn't a vessel-tracking priority signal.
 */
export async function listServiceBoards(): Promise<string[]> {
  const rows = await cwFetch<{ name: string; department?: { name?: string } }[]>(
    "/service/boards?pageSize=200&fields=id,name,department",
  );
  return sortNames(rows.filter((r) => r.department?.name !== "Admin").map((r) => r.name));
}

/** CW Project statuses (e.g. "1: Active", "5: Closed") — parallel to listCompanyStatuses. */
export async function listProjectStatuses(): Promise<string[]> {
  const rows = await cwFetch<{ name: string }[]>("/project/statuses?pageSize=200&fields=id,name");
  return sortNames(rows.map((r) => r.name));
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
export async function listMembers(): Promise<{ identifier: string; name: string }[]> {
  const rows = await cwFetch<{ id: number; identifier?: string; firstName?: string; lastName?: string }[]>(
    // conditions=inactiveFlag=false AND licenseClass="F" (URL-encoded; cwFetch sends the path raw)
    '/system/members?pageSize=1000&conditions=inactiveFlag%3Dfalse%20AND%20licenseClass%3D%22F%22&fields=id,identifier,firstName,lastName',
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
async function queryOpenTicketActivity(boardNames: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (boardNames.length === 0) return out;
  const boardList = boardNames.map((b) => `"${b.replace(/"/g, '\\"')}"`).join(",");
  const conditions = `board/name in (${boardList}) AND closedFlag=false`;
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({ pageSize: "1000", page: String(page), conditions, fields: "company,_info" });
    const batch = await cwFetch<CwActivityRow[]>(`/service/tickets?${params.toString()}`);
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
 * outranks the ticket signal above.
 */
async function queryOpenProjectActivity(statusNames: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (statusNames.length === 0) return out;
  const statusList = statusNames.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(",");
  const conditions = `status/name in (${statusList}) AND closedFlag=false`;
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({ pageSize: "1000", page: String(page), conditions, fields: "company,_info" });
    const batch = await cwFetch<CwActivityRow[]>(`/project/projects?${params.toString()}`);
    mergeActivity(out, batch);
    if (batch.length < 1000) break;
  }
  return out;
}

async function queryCompanies(conditions?: string): Promise<CwCompany[]> {
  const out: CwCompany[] = [];
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({ pageSize: "1000", page: String(page), fields: "id,name,identifier,status,customFields" });
    if (conditions) params.set("conditions", conditions);
    const batch = await cwFetch<CwCompany[]>(`/company/companies?${params.toString()}`);
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

export class ManageCwClient implements CwClient {
  async listTrackedVessels(): Promise<VesselCompany[]> {
    // A vessel = any company whose Market contains the configured value (e.g.
    // "🛳️ Yacht"), regardless of IMO/MMSI — so vessels missing an identifier
    // still surface for reconciliation. Optional status further scopes it.
    const parts = [`market/name contains "${config.cwVesselMarket}"`];
    if (config.cwTrackedStatus) parts.push(`status/name="${config.cwTrackedStatus}"`);
    const companies = await queryCompanies(parts.join(" AND "));
    return companies.map(toVessel);
  }

  async setVesselIdentifiers(id: string, patch: { imo?: string; mmsi?: string }): Promise<VesselCompany> {
    if (!isCwWritesEnabled()) {
      throw new Error("ConnectWise writes are disabled (safety gate). Enable them on the Integrations page.");
    }
    // CW requires the WHOLE customFields array on PATCH — GET, splice, PATCH back.
    const company = await cwFetch<CwCompany>(`/company/companies/${id}?fields=id,name,status,customFields`);
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
    });
    return toVessel(updated);
  }

  async listOpenTicketActivity(boardNames: string[]): Promise<Map<string, string>> {
    return queryOpenTicketActivity(boardNames);
  }

  async listOpenProjectActivity(statusNames: string[]): Promise<Map<string, string>> {
    return queryOpenProjectActivity(statusNames);
  }

  async getCompanySites(companyId: string): Promise<CwSite[]> {
    const rows = await cwFetch<{ id: number; name: string; inactiveFlag?: boolean }[]>(
      `/company/companies/${companyId}/sites?pageSize=50&fields=id,name,inactiveFlag`,
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
    if (!isCwWritesEnabled()) {
      throw new Error("ConnectWise writes are disabled (safety gate). Enable them on the Integrations page.");
    }
    const created = await cwFetch<{ id: number; name: string; inactiveFlag?: boolean }>(
      `/company/companies/${companyId}/sites`,
      {
        method: "POST",
        body: JSON.stringify({ name: "Vessel", addressLine1: "(Vessel's current location unknown)" }),
      },
    );
    return { id: String(created.id), name: created.name, inactive: Boolean(created.inactiveFlag) };
  }
}
