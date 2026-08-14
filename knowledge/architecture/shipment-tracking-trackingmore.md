---
status: active
read-when: Building or changing Shipment Tracking (INIT-0018) — the TrackingMore integration, the inbound (PO) or outbound (ticket) sync flow, the carrier code mapping, or the Carrier Status write-back.
related: [connectwise-api-integration.md, vessel-location-updating-aisstream.md, ../conventions/naming-lexicon.md, ../decisions/0002-extension-never-touches-cw-credentials.md]
updated: 2026-08-13
---

# Shipment Tracking — TrackingMore data source + two-flow design

The chosen data source and full field-level design for **Shipment Tracking** (`INIT-0018`):
pull carrier delivery status for shipments Triton sends and receives, and write a friendly
status back into ConnectWise. Two independent flows — **inbound** (vendor → Triton, PO-tied)
and **outbound** (Triton → client/project site, ticket-tied) — sharing one provider
integration. This file records the data source, the CW field-level design for both flows,
and what's still open.

## 0. Provider choice — TrackingMore over 17track

Both are multi-carrier aggregators with a **register-then-track** model (not point lookup):
register a tracking number, the provider polls the carrier itself, you either poll back or
receive a webhook. Compared head to head (2026-08-13):

| | 17track v2.4 | TrackingMore v4 |
|---|---|---|
| Carrier on register | Optional, auto-detected | **Required** (`courier_code`) — a Detect API exists as a fallback lookup |
| ETA / predicted delivery | **None found anywhere in the schema** (checked twice) | `scheduled_delivery_date` is a real schema field (carrier-dependent, often `null`, but the slot exists) |
| Milestone dates | Flatter field set | Structured `origin_info.milestone_date` object (`inforeceived_date`/`pickup_date`/`outfordelivery_date`/`delivery_date`/`returning_date`/`returned_date`) |
| Batch size | 40/request | 40/request |
| Rate limit | 3 req/s | 6–10 req/s depending on plan |
| Webhook | `TRACKING_UPDATED` event | SHA256-signed webhook payload |
| Free tier | N/A (200 free numbers one-time) | **No API/Webhook access at all on Free** — Basic ($9–11/mo, 150 credits) is the practical floor |

**Decided: TrackingMore**, primarily on the strength of the confirmed `scheduled_delivery_date`
field slot — 17track has no equivalent anywhere. The carrier-required cost turned out to be
free in practice: both flows ended up with an explicit, human-entered carrier before this
was even settled (see §2/§3), so 17track's auto-detect advantage never mattered.

**Provider-pivotability is a hard requirement (user).** Both providers share the same
register → poll-or-webhook shape and a similar coarse status taxonomy, so a normalized
interface fits either one — see §4.

## 1. Credentials

Server-side secret, same pattern as every other CAST integration
(`../decisions/0002-extension-never-touches-cw-credentials.md`):
`components/api/.env` → `CAST_TRACKINGMORE_API_KEY` (git-ignored), read via
`components/api/src/config.ts` (`config.trackingmoreApiKey`, `trackingmoreConfigured()`).
Auth header: `Tracking-Api-Key`. Base URL: `https://api.trackingmore.com/v4`
(`config.trackingmoreBaseUrl`). **Verified live 2026-08-13** — `GET /v4/couriers/all` → 200
with the real 1,653-carrier catalog.

## 2. Inbound (vendor → Triton, PO-tied)

**Read source: native ConnectWise fields — no custom fields needed for carrier or tracking
number.** Confirmed via the official field mapping (`PSA_API_Mapping.xlsx`):

- `PurchaseOrder` (`/procurement/purchaseorders/{id}`): `trackingNumber`, `shipmentDate`,
  `shipmentMethod`, and `updateShipmentInfo` — a boolean that cascades the header's shipment
  info down to every line item (exactly how Triton's staff already use it: set once at the
  header when a PO ships as one box).
- `PurchaseOrderLineItems` (`/procurement/purchaseorders/{id}/lineitems/{id}`): its own
  **per-line** `trackingNumber`, `expectedShipDate`, `shipDate`, `dateReceived`,
  `receivedStatus` (enum: `Waiting`/`FullyReceived`/`PartiallyReceiveCancelRest`/
  `PartiallyReceiveCloneRest`) — covers a PO shipping as multiple boxes with different
  tracking numbers.

**Carrier list: CW's native Shipping Methods system table** (`/procurement/shipmentmethods`),
**not** a custom field. Already comprehensive, live-verified 2026-08-13 — no gaps against the
full inbound carrier list (Amazon, DPD, FedEx [2-Day/Priority Standard/Ground/generic],
Parcelforce, Royal Mail, TNT, UPS [Next Day Air/2nd Day Air/Ground/generic], USPS
[Priority/Express/generic], LTL, plus Hand-Carry and Courier Service already present).

### 2.1 PO line item ≠ ticket Product — a real many-to-many, not the same record

A common wrong assumption to avoid: **`Purchase_Detail` (PO line item) and `IV_Product`
(the ticket/project-attached Product/Addition) are separate database rows**, linked by a
genuine join table, `IV_Product_Purchase_Detail` (own PK, FK to both sides, plus a
`Quantity` column — tracking how much of a PO line's quantity went to a given ticket demand).
Confirmed at the schema level and live-verified in both directions by LogisticsCoordinator's
own `get_po_line_demand_links()` (`GET /system/reports/PurchaseOrderWithLineItems` — the
same system report CAST should reuse for this join, not a new mechanism to invent). One PO
line can supply multiple tickets; one ticket's demand can be split across multiple PO lines.

**Consequence:** anything written directly onto a `Purchase_Detail` record (a note, a custom
field) does **not** appear on the linked `IV_Product` record — they're different rows. CW
*does* run its own internal one-way sync from PO → linked ticket-Product for a specific set
of fields (confirmed via the `IV_Product` schema): `Purchase_Tracking_Numbers` (tracking
number mirror), `Detail_ShipmentMethod`/`ShipmentMethod_RecID` (carrier mirror),
`Purchase_Info` (a CW-managed composite "PO number + PO status" string — **not writable**,
would either get overwritten by CW's own sync or corrupt what CW's UI expects), `Received`/
`Received_Flag`, `Detail_Serial_List`, `Qty_Shipped`/`Qty_Picked`, `Purchase_Date`,
`PO_Approved_Flag`, `Vendor_RecID`/`Vendor_SKU`. None of these is a freeform status field
CAST can write into — hence the new custom field below.

### 2.2 Write-back — Carrier Status, on both sides

**Decided (user, 2026-08-13): write the same friendly status to both records.** Two new
custom fields, same caption on both screens:

- **`Carrier Status`** (Text) on the **PO Line Item** screen (`Purchase_Detail` — a screen
  with no existing custom fields in this org).
- **`Carrier Status`** (Text) on the **Product** screen (`IV_Product`/ticket-side —
  deliberately a different field from the existing outbound-purpose trio on that same screen,
  see §3.3).

For a PO line linked to multiple ticket Products (the split-PO case, §2.1), CAST writes the
same value to **every** linked Product, not just one — there's no single "correct" one to
pick when a line genuinely supplies several tickets.

**Content:** a friendly, human-readable one-liner (a UX choice for CW's list views —
`listViewFlag: true` on these fields — not a technical limit; the real storage column is
`nvarchar(1000)`, confirmed via `*_User_Defined_Field_Value` tables). Status mapped through a
friendly-label table (same pattern as vessel tracking's `navStatus.ts`), composed with the
most relevant date/event:

- `"In Transit — last scan Aug 13, Memphis TN"`
- `"Delivered Aug 12, 2:31 PM"`
- `"Out for Delivery"`
- `"Exception — Delivery Failed, contact carrier"`

**"In Transit," not "En Route"** (decided 2026-08-13) — matches TrackingMore's own
`InTransit` status almost verbatim (no interpretive gap) and is the term already on every
carrier's own tracking page. Canonical — see `../conventions/naming-lexicon.md`.

### 2.3 PO status lifecycle

Live PO status list (`/procurement/purchaseorderstatuses`, sorted by `sortOrder`):

| Status | `closedFlag` | `defaultClosedFlag` | Meaning for tracking |
|---|---|---|---|
| 🔶 New | false | — | Not yet tracking — nothing's shipped |
| 🔵 Sent to Vendor | false | — | Actively tracking |
| 🟡 On Order | false | — | Actively tracking |
| ⚠️ Backordered | false | — | Actively tracking |
| ✅ Received In Full | **true** | **true** | Stop tracking — final "Delivered"-style write |
| 🟪 Cancelled | **true** | false | Stop tracking — different final write (don't leave a stale "In Transit") |

**The logic keys off `closedFlag`/`defaultClosedFlag`, not hardcoded status names** — a
generic "still open" vs. "closed, and was it the successful-completion status" check survives
a status rename. Only start tracking a line once it has a populated `trackingNumber`.

### 2.4 Permissions

`app_CAST`'s security role needed explicit Procurement grants beyond what `INIT-0012`/`0014`
already had — all **confirmed granted and live 200 OK as of 2026-08-13**:
Purchase Orders, Products, Shipment Methods, Purchase Order Statuses.

## 3. Outbound (Triton → clients/project sites, ticket-tied)

**Ticket scope:** Ticket **Type = "Logistics"**, **Subtype = "Shipping"**. Query verified live
against `/service/tickets`: `conditions=type/name="Logistics" AND subType/name="Shipping"`
(valid, 200 — 0 matches as of this writing, since no tickets carry the combo yet).

### 3.1 Carrier + tracking number fields (live in Production + Sandbox)

Both on the **Ticket** screen (`sr100`):

- **`Shipment Tracking #`** (id 69, Text) — the master tracking number for the whole
  shipment (not per-box — see §3.4).
- **`Shipment Carrier`** (id 70, `entryTypeIdentifier: "List"` — CW's native picklist type).
  `displayOnScreenFlag: false` — deliberately hidden from the raw ticket screen; see §3.2 for
  why. 14 values, alphabetical:

  ABF · DHL Express · DHL Global Forwarding · DSV · Estes · Expeditors · FedEx ·
  FedEx Freight · Forward Air · Roadrunner · UPS · USPS · XPO · **(Non-Standard)**
  (user-added catch-all, not part of the original compiled list)

  Every value except Forward Air has a confirmed working TrackingMore `courier_code`
  (Forward Air isn't in TrackingMore's 1,653-carrier catalog at all — a real coverage gap,
  not a detection problem; treat as a manual/exception case).

### 3.2 Data-entry surface: LogisticsCoordinator, not CW directly

**Logistics staff always use LC for shipment prep and entry** (user, 2026-08-13) — never the
raw CW ticket screen. LC writes back to the appropriate CW fields (`Shipment Carrier`,
`Shipment Tracking #`) as necessary. **CAST does not integrate with LC directly** — it only
ever reads ConnectWise, same as every other CAST integration. This is *why* `Shipment
Carrier` is `displayOnScreenFlag: false`: the field exists as an API-readable value slot
(and, per the user's intent, its option list is meant to drive LC's own carrier dropdown too),
not as something staff fill in on the ticket screen itself.

LC's own schema (`LogisticsCoordinator/backend/app/database.py` /
`models/schemas.py`, confirmed live in source): `shipments.id` is literally the **CW ticket
number** (`ShipmentCreate.id: "CW ticket number"` — an exact, pre-existing join key), plus
`shipments.carrier` (free text, from a picklist) and `shipments.awb_number` (the tracking
number). `shipments.status` is LC's own packing-workflow stage, separate from the CW ticket's
own board status.

**Known, accepted limitation:** `awb_number` is a single `TEXT` column — LC only ever
captures **one** tracking number per shipment, regardless of box count. This predates CAST's
design entirely; it isn't a new tradeoff CAST introduces. If a multi-box shipment's boxes get
physically separated in transit (more common for LTL freight than parcel), CAST's status
reflects only the tracked box. Accepted for now, given multi-box shipments overwhelmingly
travel together; revisit only if this proves operationally significant (would need an LC
schema change — likely bundled with `INIT-0026`'s eventual LC-into-CAST migration).

### 3.3 Naming collision avoided — two different "Shipping Status"-shaped fields

The Product screen already carries an **outbound-purpose trio**, all built by the user
2026-06-23/2026-08-13, unrelated to inbound: `Shipment ID` (id 54), `Shipping Status`
(id 55), `Shipment Box/Pallet ID` (id 56) — used for tracking *individual boxes/pallets
within* one outbound shipment, subordinate to the ticket-level master
`Shipment Tracking #`/`Shipment Carrier`. The new inbound write-back fields are deliberately
named **`Carrier Status`** (§2.2), not `Shipping Status`, specifically to avoid colliding with
this existing outbound field on the same screen.

### 3.4 Carrier-detection ruleset — considered, not used

Before the LC-integration answer settled things (§3.2), a carrier-detection safety net was
designed and live-tested against TrackingMore's `POST /couriers/detect`: filtering Detect's
suggestions against Triton's known-carrier allowlist correctly resolved 5/8 live test cases
and correctly punted the other 3 to a human, with zero silently-wrong results. Real collision
risks were found and confirmed live: generic FedEx-format numbers sometimes resolved to
**GLS** (an unrelated EU carrier) instead, and generic LTL-PRO-shaped numbers never suggested
an actual LTL carrier at all, only unrelated small-parcel EU carriers (BRT/DPD/Poste
Italiane). **Not needed in the shipped design** — both flows ended up with an explicit,
human-entered carrier (native `shipmentMethod` for inbound, LC → `Shipment Carrier` for
outbound). Keep this note in case LC's carrier capture ever becomes unreliable enough that a
detection fallback is worth revisiting.

### 3.5 Still open — outbound write-back target

**Not yet decided.** Two options raised, neither confirmed: advance the CW ticket's own board
status as the shipment progresses (reusing what LC's `ShipmentPage` already reads/writes via
`GET/PATCH /api/cw/board/{id}/statuses` for its own packing-workflow stages — risk: could
collide with whatever statuses LC itself sets during prep), or a separate new free-text field
mirroring inbound's `Carrier Status`. **Resolve before building the outbound write path.**

## 4. Provider abstraction (design sketch, not yet built)

Mirrors the `CwClient` interface + Stub/real pattern already used throughout
`components/api/src/connectwise/`:

```typescript
// components/api/src/shipments/provider.ts — design sketch
export type ShipmentMainStatus =
  | "NotFound" | "InfoReceived" | "InTransit" | "Expired"
  | "AvailableForPickup" | "OutForDelivery" | "DeliveryFailure"
  | "Delivered" | "Exception";

export interface NormalizedTrackingStatus {
  status: ShipmentMainStatus;
  subStatus?: string;
  lastEventAt?: string;              // ISO
  lastEventDescription?: string;
  milestones: {
    infoReceivedAt?: string;
    pickedUpAt?: string;
    outForDeliveryAt?: string;
    deliveredAt?: string;
  };
  scheduledDeliveryDate?: string;    // ETA — carrier-dependent, often absent
}

export interface ShipmentTrackingProvider {
  register(shipments: { trackingNumber: string; carrierCode: string; ref: string }[]): Promise<void>;
  getStatus(trackingNumbers: string[]): Promise<Map<string, NormalizedTrackingStatus>>;
}
```

`TrackingMoreProvider` (real) + a `StubTrackingProvider` (dev/test), selected by
`trackingmoreConfigured()` — same selection pattern as `getCwClient()`. The normalized shape
is deliberately provider-agnostic (both 17track and TrackingMore fit it) so a future provider
swap is a new implementation of this interface, not a redesign — satisfies the
provider-pivotability requirement from `INIT-0018`.

## 5. Carrier code mapping (TrackingMore `courier_code`, live-verified 2026-08-13)

| Triton carrier | `courier_code` |
|---|---|
| ABF | `abf` |
| Amazon | `amazon` (or `amazon-uk` for UK-origin) |
| DHL Express | `dhl` |
| DHL Global Forwarding | `dhl-global-logistics` |
| DPD | `dpd` (or `dpd-uk`) |
| DSV | `dsv` |
| Estes | `estes` |
| Expeditors | `expeditors` |
| FedEx | `fedex` |
| FedEx Freight | `fedex-freight` |
| **Forward Air** | **not in TrackingMore's catalog — manual/exception case** |
| Parcelforce | `parcel-force` |
| Roadrunner | `rrts` |
| Royal Mail | `royal-mail` |
| TNT | `tnt` (or `tnt-uk`) |
| UPS | `ups` |
| USPS | `usps` |
| XPO | `xpoweb` |
