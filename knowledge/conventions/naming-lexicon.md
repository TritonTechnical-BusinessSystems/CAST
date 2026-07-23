---
status: active
read-when: Naming anything in code, database, API, or UI.
related: []
updated: 2026-07-18
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
| The specific CW site/location record whose address gets overwritten with a vessel's current position | **Target Location** (`target_location`) | One per vessel-company — never assume "primary site," must be explicit per `INIT-0012`. |
| The feature pulling vessel position/status and updating Target Location | **Vessel Location Updating** (`vessel_location_updating`) | Canonical feature name — see `INIT-0012`. |

> Fill this table as the domain model solidifies. Terms that are easy to conflate should carry an explicit "never interchange" note.

## Identity rule
Everything is identified internally by **opaque, stable IDs** (e.g. UUIDv7/ULID), never by a user-chosen name. Names/labels are mutable attributes. This is what makes rename, re-parent, and swap-upgrade safe.

## Canonical keys, not display strings
Code/DB/API reference stable **canonical keys**, never display strings. If the product needs tenant-renamable labels or i18n, resolve keys → labels through a terminology layer (record that as an ADR). Building this from day one keeps every user-facing string swappable.
