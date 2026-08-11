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
| A vessel matching the saved Tracking Config rule (Company Status + Identifiers) | **Tracked Vessel** (`tracked_vessel`) | Canonical per `INIT-0015`. Avoid "followed," "synced," "monitored" as synonyms. Membership does **not** depend on open work — see Monitoring Tier. |
| Which of the ≤50-per-subscription real-time slots a Tracked Vessel gets in the AIS monitor | **Monitoring Tier** (`monitoring_tier`) — **Tier 1** (real-time, dedicated subscription) or **Tier 2** (periodic, rotated subscription) | `INIT-0012` §3.6. Promotion to Tier 1 is derived (open ticket on a selected board, or a manual pin) — never confuse with Tracked-Vessel membership itself. |
| An operator override forcing a vessel always into Tier 1, or out of AIS tracking entirely | **Pinned Vessel** (always Tier 1) / **Excluded Vessel** (never tracked) | `INIT-0015`'s "manual pin/exclude override layer," `components/api/src/vessels/priority.ts`. An Excluded Vessel is dropped regardless of matching the tracking rule. |
| The CW site (per company) that AIS status/location results get written to — the company's site whose name starts with "Vessel" | **Vessel Site** (`vessel_site`) | `INIT-0012`, `components/api/src/vessels/siteResolution.ts`. Resolved once, then **cached by site ID** — a later rename doesn't break the mapping; only the site being deleted or inactivated does (clears the cache, re-detects). A Tracked Vessel with no resolvable Vessel Site is excluded from AIS tracking (same hard-requirement tier as a missing MMSI). Never call it "Target Location" (superseded) or "the site" alone. |

> Fill this table as the domain model solidifies. Terms that are easy to conflate should carry an explicit "never interchange" note.

## Identity rule
Everything is identified internally by **opaque, stable IDs** (e.g. UUIDv7/ULID), never by a user-chosen name. Names/labels are mutable attributes. This is what makes rename, re-parent, and swap-upgrade safe.

## Canonical keys, not display strings
Code/DB/API reference stable **canonical keys**, never display strings. If the product needs tenant-renamable labels or i18n, resolve keys → labels through a terminology layer (record that as an ADR). Building this from day one keeps every user-facing string swappable.
