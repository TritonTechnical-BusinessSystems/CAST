---
status: active
read-when: Building or changing CAST's ConnectWise PSA (Manage) API integration — the credentialed read/write path (INIT-0002 / 0012 / 0014), auth, custom-field read/write, or the ManageCwClient.
related: [vessel-location-updating-aisstream.md, ../decisions/0002-extension-never-touches-cw-credentials.md]
updated: 2026-07-23
---

# ConnectWise PSA (Manage) REST API — integration pattern

CAST's credentialed path *into* ConnectWise (distinct from the extension, which
**never** touches CW creds — `../decisions/0002`). Powers the vessel-identity
write-back (`INIT-0014`) and, later, Vessel Location Updating (`INIT-0012`) and
the broader data-sync component (`INIT-0002`).

The mechanics below are proven — they mirror **LogisticsCoordinator's live CW
integration** (which is Python/httpx; CAST reimplements the same pattern in
TypeScript in `components/api/src/connectwise/`). LC reference:
`/home/matt/projects/Triton/LogisticsCoordinator/CLAUDE.md` §"ConnectWise API
Reference" and `backend/app/services/cw_client.py`, plus the official
`cw-api/PSA.postman_collection.json`.

## 1. Credentials (server-side only)

Env vars (`components/api/src/config.ts`, `.env`): `CW_BASE_URL`, `CW_COMPANY`,
`CW_PUBLIC_KEY`, `CW_PRIVATE_KEY`, `CW_CLIENT_ID`. Secrets live in `.env` only
(`decisions/0002`); `cwConfigured()` gates the real client vs. the stub.

**Use a DEDICATED API Member for CAST** — not shared with LogisticsCoordinator's
integration (separate blast radius, independent revocation). Create via
*System → Members → API Members*; least-privilege Security Role (Companies
Inquire+Edit covers company custom fields).

## 2. Auth header

```
Authorization: Basic base64( "{CW_COMPANY}+{CW_PUBLIC_KEY}:{CW_PRIVATE_KEY}" )
clientId:      {CW_CLIENT_ID}          // camelCase header
Content-Type:  application/json
```
Note the literal `+` between company and public key, and `:` before the private
key, all inside the base64.

## 3. Base URL

`https://na.myconnectwise.net/v4_6_release/apis/3.0` (NA region), then relative
paths (`/company/companies/{id}`). Triton company id: `tritontech` (prod),
`tritontech_cs1` (sandbox). Staging host: `staging.connectwisedev.com`.

## 4. Read a company custom field

```
GET /company/companies/{id}
→ company.customFields.find(cf => cf.caption === "IMO")?.value
```
`customFields` entry shape: `{ id: number, caption: string, value: string|number|boolean|null }`.
Discover field ids with `GET /system/userDefinedFields`.

**Query by custom-field value (server-side filter)** — the key trick for scoping
the tracked fleet without pulling every company:
```
GET /company/companies?customFieldConditions=caption="MMSI" AND value=""
    &conditions=status/name="Active"&pageSize=1000&page=1
```
Paginate: loop `page`, stop when a page returns fewer than `pageSize`. Chunk any
`id in (...)` list to ≤100 to stay under the ~8 KB URL limit.

## 5. Write a custom field (JSON Patch, RFC 6902)

```
PATCH /company/companies/{id}
[ { "op": "replace", "path": "/customFields",
    "value": [ /* the WHOLE customFields array, each {id, caption, value} */ ] } ]
```
CW requires the **entire** `customFields` array (with ids + captions), not a
single element — so: GET the company, splice the one value, PATCH the whole
array back. 204/empty body = success.

## 6. Client shape in CAST

`components/api/src/connectwise/client.ts` defines `CwClient` (interface) with an
in-memory `StubCwClient` (active until keys land) and — to build next —
`ManageCwClient` implementing the calls above, selected by `cwConfigured()` in
`getCwClient()`. HTTP via `fetch` (Node 24 global) or axios; add **429/retry
backoff fresh** (LC's reference has none).

## 7. Live status (verified 2026-07-23)

Connection **verified** against `tritontech` (NA cloud, CW `v2025.1`) with the
`app_CAST` API member + clientId. `GET /system/info`, company read, and company
**custom-field read all return 200** — so INIT-0014 reconciliation can read/write
IMO/MMSI now.

**Discovered custom-field captions** (company UDFs): `Vessel IMO` (id 13, Text),
`Vessel MMSI` (id 61, Text). Also present: `Vessel Length (in Meters)` (51),
`Management Company` (41), `Previous Name` (58), `Last Refit` (20), `Refit Cycle
(in years)` (21), `Client KB Location` (39). `CW_IMO_FIELD_CAPTION` /
`CW_MMSI_FIELD_CAPTION` set accordingly.

**Permission gaps — RESOLVED 2026-07-23** (role updated). Now readable:
- `GET /company/companies/statuses` → 200. Statuses: `Active`, `Former Client`,
  `Credit Hold`, `Not Approved`, `Active /w Special Note`.
- `GET /service/boards` → 200 (23 boards: `Projects`, `Monitoring`,
  `Support Incidents`, `Sales Engineering`, `Client Onboarding`, `Project Sales`, …).
- Note: `GET /project/boards` → **404 (endpoint doesn't exist)** — not a
  permission issue; query projects via `/project/projects`. Open work for
  `INIT-0015` = service tickets by board (`closedFlag=false`) + projects.

Still open: which company **status** = a tracked vessel-client
(`CW_TRACKED_STATUS`) — `Active` (± `Active /w Special Note`) is the likely pick.
