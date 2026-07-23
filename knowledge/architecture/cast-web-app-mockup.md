---
status: active
read-when: Working on the CAST web app's UI/IA, its login screen, or the Vessel Tracking section (which contains Vessel Location Updating) — or evolving the mockup itself.
related: [browser-extension.md, extension-telemetry-and-identity.md, ../decisions/0004-monorepo-with-artifacts-only-public-surface.md]
updated: 2026-07-18
---

# CAST web app — first mockup pass

The CAST web app (`INIT-0008`) has a hosting target but no design yet. This
file records the **first mockup's** information architecture and the
decisions it embodies, so later passes build on it instead of re-deriving
it. It is a visual/interactive prototype (clickable HTML, no backend) — not
an implementation plan. Tech stack remains undecided.

---

## 1. Information architecture

Two Workspace sections behind a single login gate, not per-feature apps —
each a single nav item, tabbed internally:

1. **Browser Extension** (nav label; route `/extension`) — tabs mirror the
   extension's own design record rather than inventing new concepts:
   - **Role Rules** — hide/show/order/move rules per role/department
     (`browser-extension.md` §5).
   - **Expected Pods** — per-screen-type expected-pod schema driving the
     missing-pod banner (`browser-extension.md` §6, `INIT-0004`).
   - **Fleet** — the check-in catalog, grouped per active CW member (real
     users only, not API members), each with their device/browser pairs, and
     an All / Current / Needs-attention filter over an adjustable freshness
     threshold (`extension-telemetry-and-identity.md` §3, `INIT-0009`).
   - **Deployment** — published rules version/build, stable vs. canary,
     publish control, stale-banner threshold.
2. **Vessel Tracking** (nav label; route `/vessel-tracking`) — tabs:
   - **Vessel Location** — the **Vessel Location Updating** feature (`INIT-0012`):
     a client (vessel) list keyed by IMO number, with navigational status,
     current position, target location, and a manual sync trigger, standing in
     for the eventual scheduled job.
   - **Vessel Identity** — IMO/MMSI presence + validity audit with lookup links.
   - **Tracking Config** — which statuses/boards define the tracked-vessel set.
   - **Geo Alerts** — define areas and the CW action on vessel entry.

Rationale for one-section-per-domain with internal tabs (rather than one nav
item per concept): the extension's config surfaces are all facets of "managing
the extension," and — likewise — vessel location, identity, tracking scope, and
geo alerts are all facets of "tracking the fleet," looked at together during the
same workflow. Splitting either into separate top-level pages would scatter a
single mental task across navigation.

## 2. Authentication

- **Primary path:** Triton's internal/on-prem Active Directory, gated by
  membership in a specific AD security group — placeholder name "CAST
  Users" in the mockup pending a real group name.
- **Fallback path:** a local account (credentials held by the app itself,
  not AD), for when the AD integration is unreachable. Presented as
  visually secondary — a disclosed "trouble signing in?" affordance, not a
  second equal-weight login form — so it can't be mistaken for the everyday
  path.
- **Mechanism is explicitly not yet decided** — LDAPS bind, Windows
  Integrated Auth, or Entra ID/ADFS federation are all still open, and
  affect only the backend, not this mockup's screen. Full open-question
  tracking lives in `INIT-0008`'s fleshing-out notes, not here — this file
  covers the screen, not the mechanism.

## 3. Visual identity

Palette and marks are derived from Triton's existing logo
(`dev-resources/Triton/triton-logo-full.png`): deep navy + slate grey, with
a teal "signal" accent introduced for interactive state (links, active
tab, focus) — kept distinct from the structural navy so it reads as one
deliberate accent rather than brand-blue-everywhere. Navigational-status
pills use semantic (non-brand) color, since they're operational state, not
identity.

## 4. Explicitly out of scope for this pass

- Any real authentication backend, API, or data persistence — mockup only.
- A dedicated user/access-management screen (who's in the AD group, local
  account provisioning) — implied by the login design but not built here.
- The vessel data source integration itself — see `INIT-0012`'s open
  questions (data source/legality, eligible CW status, custom-field
  mapping, target-location selection rule, sync cadence).
