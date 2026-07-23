---
status: active
read-when: Working on the CAST web app's UI/IA, its login screen, or the Vessel Location Updating page — or evolving the mockup itself.
related: [browser-extension-view-manager.md, extension-telemetry-and-identity.md, ../decisions/0004-monorepo-with-artifacts-only-public-surface.md]
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

Two functional pages behind a single login gate, not per-feature apps:

1. **CAST Extension** — one page, tabbed internally. Tabs mirror the
   extension's own design record rather than inventing new concepts:
   - **Role Rules** — hide/show/order/move rules per role/department
     (`browser-extension-view-manager.md` §5).
   - **Expected Pods** — per-screen-type expected-pod schema driving the
     missing-pod banner (`browser-extension-view-manager.md` §6, `INIT-0004`).
   - **Fleet** — the check-in catalog: device, OS account, CW user, browser,
     extension version, rules version, last check-in
     (`extension-telemetry-and-identity.md` §3, `INIT-0009`).
   - **Deployment** — published rules version/build, stable vs. canary,
     publish control, stale-banner threshold.
2. **Vessel Location Updating** (`INIT-0012`) — a client (vessel) list keyed
   by IMO number, with navigational status, current position, target
   location, and a manual sync trigger, standing in for the eventual
   scheduled job.

Rationale for one-page-per-component with internal tabs (rather than one nav
item per concept): the extension's config surfaces are all facets of
"managing the extension," and department/role rule authoring, pod schema,
fleet visibility, and deployment control are looked at together during the
same workflow — splitting them into separate top-level pages would scatter
a single mental task across navigation.

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
