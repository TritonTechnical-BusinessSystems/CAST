---
status: active
read-when: Naming anything in code, database, API, or UI.
related: []
updated: 2026-08-11
---

# Naming lexicon (ubiquitous language)

**One canonical key per concept**, used identically in code, DB, and API. Intentional naming is a hard requirement — no synonyms proliferating. Separate concerns ruthlessly (e.g. **physical** vs **logical**). This file is the source of truth for the canonical terms.

## Canonical terms

| Concept | Default label (`key`) | Notes / avoid |
|---|---|---|
| _<concept>_ | **_<Label>_** (`_key_`) | _<synonyms to avoid; disambiguation notes>_ |
| AD security group gating CAST web app login | **CAST Users** (`cast_users_group`) | Placeholder name pending final AD group naming — see `INIT-0008`. Never call it "the whitelist." |
| Non-AD fallback login credential in the CAST web app | **Local Account** (`local_account`) | Fallback-only, for when AD auth is unreachable — never present as an equal-weight everyday login option. Don't call it "backup login" or "admin login." |
| A client (CW company) tracked by vessel position | **Vessel** (`vessel`) | The CW company record itself, not a separate entity — a company *is* a vessel when it carries an IMO number. |
| The vessel's permanent international identifier, stored in a CW company custom field | **IMO Number** (`imo_number`) | Always "IMO Number," never bare "IMO" in UI copy — collides with the International Maritime Organization. |
| A vessel's current activity state (underway / moored / anchored / dry docked / docked) | **Navigational Status** (`navigational_status`) | Don't call it "vessel state" or "status" alone — reserve bare "status" for CW company/ticket status. |
| ~~The specific CW site/location record whose address gets overwritten~~ | ~~**Target Location**~~ | **Superseded 2026-07-22** — the write target is friendly status + place name, not a street address. Don't use this term; it describes a plan replaced before anything was built against it. The real write-target concept is **Vessel Site**, below. |
| The feature pulling vessel position/status and writing it back to ConnectWise | **Vessel Location Updating** (`vessel_location_updating`) | Canonical feature name — see `INIT-0012`. |
| A vessel matching the saved Tracking Config rule (Company Status + Identifiers) | **Tracked Vessel** (`tracked_vessel`) | Canonical per `INIT-0015`. Avoid "followed," "synced," "monitored" as synonyms. Membership does **not** depend on open work — see Trackable Vessel, Monitoring Tier. |
| A Tracked Vessel with a valid MMSI **and** a resolved Vessel Site — everything AIS *could* subscribe to and write results for | **Trackable Vessel** (`trackable_vessel`) | `INIT-0012` (2026-08-11). Both are hard requirements checked in `prioritizeVessels`; failing either drops a vessel out of AIS coverage entirely, even if it's still a Tracked Vessel. Not every Trackable Vessel gets *coverage* — see Monitoring Tier. |
| Which of the ≤50-per-subscription real-time slots a Trackable Vessel gets in the AIS monitor | **Monitoring Tier** (`monitoring_tier`) — **Tier 1** (real-time, dedicated subscription) or **Tier 2** (periodic, rotated subscription); a third (unnamed) bucket gets **no coverage** | `INIT-0012` §3.6, **decided 2026-08-11**. Strict priority groups, not additive scoring: every vessel with an **open Project in a selected status** outranks every vessel with only an **open ticket on a selected board**, no exceptions; within a group, most-recent activity wins. A Trackable Vessel with **neither** gets no AIS coverage at all — not even Tier 2. **No manual override of any kind exists** — see below. |
| ~~An operator override forcing a vessel into Tier 1, or removing it from AIS tracking entirely~~ | ~~**Pinned Vessel**~~ / ~~**Excluded Vessel**~~ | **Both rejected and removed 2026-08-11 (user).** Pin first (no one person should arbitrarily promote a vessel outside the formula), then exclude too, same principle — to stop tracking a vessel, remove its MMSI in ConnectWise (already a hard requirement) instead of a CAST-side toggle. Every Tier 1/2 outcome is a formula result, never a standing manual decision. Don't reintroduce either term or a settings-backed override for this. |
| The CW site (per company) that AIS status/location results get written to — the company's site whose name starts with "Vessel" | **Vessel Site** (`vessel_site`) | `INIT-0012`, `components/api/src/vessels/siteResolution.ts`. Resolved once, then **cached by site ID in CAST's own local database** — the tier engine and preview read only that local cache, never ConnectWise directly. **Decided 2026-08-11 (user):** "we'll already have the site IDs locally — keep it local, don't look to ConnectWise unless needed." A rename never breaks the mapping; only the site being deleted/inactivated does, and even then CAST **auto-creates** a replacement (opt-in, "Automatically create a Vessel site..." on Tracking Config) rather than leaving the vessel excluded indefinitely — "it only fails once, instead of continuing to fail" (user). With auto-create off, a Tracked Vessel with no resolvable Vessel Site stays excluded (same hard-requirement tier as a missing MMSI). **What gets written (2026-08-11, user):** the site's **name** = friendly status + place/destination (e.g. "Vessel docked in La Ciotat, France"); **addressLine1** = raw decimal coordinates ("lat, lon") for ConnectWise's own address-search/Google-Maps lookup — `components/api/src/vessels/siteWriter.ts`. Never call it "Target Location" (superseded) or "the site" alone. |

| The feature pulling carrier delivery status and writing it back to ConnectWise, both directions | **Shipment Tracking** (`shipment_tracking`) | Canonical feature name — see `INIT-0018`. Two independent flows: **inbound** (vendor → Triton, PO-tied) and **outbound** (Triton → client/project site, ticket-tied) — don't conflate them, they use entirely different CW record types and read sources. |
| A shipment actively moving, not yet delivered | **In Transit** (`in_transit`) | `INIT-0018`, decided 2026-08-13. Not "En Route" — matches TrackingMore's own `InTransit` status almost verbatim, and is the term staff already see on every carrier's own tracking page. |
| The custom field (present on both the PO Line Item and ticket-side Product screens, inbound only) holding CAST's friendly, human-readable carrier status | **Carrier Status** (`carrier_status`) | `INIT-0018`. Same value written to both screens — a PO line item and its linked ticket Product(s) are genuinely separate CW records (joined many-to-many via `IV_Product_Purchase_Detail`, not the same row), with no native sync for arbitrary custom-field values between them. Don't confuse with the pre-existing, outbound-only `Shipping Status` field (id 55) on the Product screen — different field, different flow. |

> Fill this table as the domain model solidifies. Terms that are easy to conflate should carry an explicit "never interchange" note.

## Identity rule
Everything is identified internally by **opaque, stable IDs** (e.g. UUIDv7/ULID), never by a user-chosen name. Names/labels are mutable attributes. This is what makes rename, re-parent, and swap-upgrade safe.

## Canonical keys, not display strings
Code/DB/API reference stable **canonical keys**, never display strings. If the product needs tenant-renamable labels or i18n, resolve keys → labels through a terminology layer (record that as an ADR). Building this from day one keeps every user-facing string swappable.
