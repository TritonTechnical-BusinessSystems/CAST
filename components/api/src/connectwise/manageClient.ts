/**
 * ConnectWise PSA (Manage) REST client — live implementation of CwClient.
 * Auth/base-URL/custom-field pattern mirrors LogisticsCoordinator's proven
 * integration (knowledge/architecture/connectwise-api-integration.md).
 *
 * SAFETY: every write checks config.cwWritesEnabled and refuses otherwise —
 * the user gate. Reads are always allowed.
 */
import { config } from "../config";
import { resolveCwCreds, type CwCreds } from "./creds";
import type { CwClient, VesselCompany } from "./client";

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

export async function listCompanyStatuses(): Promise<string[]> {
  const rows = await cwFetch<{ name: string }[]>("/company/companies/statuses?pageSize=200&fields=id,name");
  return rows.map((r) => r.name);
}

export async function listServiceBoards(): Promise<string[]> {
  const rows = await cwFetch<{ name: string }[]>("/service/boards?pageSize=200&fields=id,name");
  return rows.map((r) => r.name);
}

/** CW members — the source of truth for who the extension check-ins belong to. */
export async function listMembers(): Promise<{ identifier: string; name: string }[]> {
  const rows = await cwFetch<{ id: number; identifier?: string; firstName?: string; lastName?: string }[]>(
    "/system/members?pageSize=1000&fields=id,identifier,firstName,lastName",
  );
  return rows.map((r) => ({
    identifier: r.identifier ?? String(r.id),
    name: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.identifier || String(r.id),
  }));
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
    if (!config.cwWritesEnabled) {
      throw new Error("ConnectWise writes are disabled (safety gate). Set CW_WRITES_ENABLED=true to allow.");
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
}
