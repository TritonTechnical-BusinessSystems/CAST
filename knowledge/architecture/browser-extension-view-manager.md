---
status: active
read-when: Working on the CAST browser extension, or making a decision from this repo that touches it (shared config hosting, naming, deployment).
related: [../decisions/0002-extension-never-touches-cw-credentials.md]
updated: 2026-07-18
---

# CAST browser extension — design & decision record

Chrome extension for Triton Technical that standardizes ConnectWise PSA's UI per
role/department — hiding, showing, and reordering elements — so users don't
individually customize each view and people in similar roles see consistent
screens.

**Repo:** this one. Source lives at `components/view-manager-extension/` in
the private CAST monorepo, developed in lockstep with its
sibling **CAST web app** (`INIT-0008`). Public-facing name: **CAST** — same
brand as the web app, distinguished only by context ("the CAST browser
extension" vs. "the CAST web app"). The planning phase referred to it as
"Triton View Manager for ConnectWise", and before that
`TritonTechnical-BusinessSystems/TritonViewManagerForPSA` — see `INIT-0001`.
Nothing here is ever published as source — only CI-generated build output
(`.crx`, update manifest, rules JSON) reaches a public, deliberately unlisted
host, since that's the only thing Chrome's auto-update mechanism actually
requires to be public. Full reasoning: `../decisions/0004-monorepo-with-artifacts-only-public-surface.md`
(supersedes the earlier separate-repo plan in `../decisions/0003-extension-repo-topology.md`).

This is the design/decision record from the planning phase. Read it before
making architectural changes — several approaches were tried and ruled out
live against the org's actual ConnectWise instance; don't re-derive them from
scratch.

---

## 1. What this is, precisely

Three capability tiers, deliberately kept separate because they have very
different risk profiles:

1. **Hide/show/reorder static UI chrome** (buttons, ribbon items, form
   fields, already-docked pods) — CSS-based, low risk, the bulk of the
   extension.
2. **Detect and prompt to add missing pods** — a currently-undocked pod
   cannot be shown via CSS (see §4); handled via a dismissible banner +
   `chrome.debugger`-driven one-shot automation (see §6).
3. **Aggregating cross-system data into new custom pods** — explicitly OUT of
   scope for this extension. Use ConnectWise's native "Hosted APIs" feature
   (custom pods/tabs backed by a properly-secured server-side integration
   using real API keys) instead. Never put ConnectWise API credentials in
   this extension — it's publicly hosted on GitHub. See
   `../decisions/0002-extension-never-touches-cw-credentials.md`.

---

## 2. Environment confirmed during investigation

- Instance tested: `na.myconnectwise.net`, ConnectWise Manage `v2025_1`.
- The web UI is built on **GWT (Google Web Toolkit)**. Obfuscated
  compiler-generated classes look like `GMDB3DUBxxx` (meaningless, DO NOT
  target these). Alongside them, the app also emits **stable, semantic
  classes** — target these instead:
  - `pod_<name>` / `pod_<name>_header` — every pod on a screen (e.g.
    `pod_service_ticket_company`, `pod_service_ticket_discussion`,
    `pod_configurations`, `pod_service_expense_list`,
    `pod_service_product_list`). Third-party "Hosted API" pods appear as
    `pod_hosted_N`.
  - `mm_label` — individual list-item rows in various widgets.
  - `cw-dual-list-view-from-list` / (implied) `-to-list` — the two columns
    in the Pod Configuration picker.
  - `cw-dual-list-view-right-button` / `-left-button` — move buttons in that
    picker.
  - `x-view-highlightrow` — appended to an item's class when selected.
  - `cw_ToolbarButton_Settings` — the gear/settings icon (⚠️ visually close
    to a trash/delete icon in the ticket toolbar — see §8, near-miss).
- **Pod layout is table-based** (`<tr><td>` per pod), not flex/grid. CSS
  `order` (used elsewhere in this extension for flex nav bars) does **not**
  work for reordering pods — use a `move` rule (DOM `insertBefore`/
  `appendChild`) instead. Hiding a pod (its row) should collapse cleanly.

---

## 3. Role/department detection

Confirmed reliable source: **`localStorage.getItem('session/MemberWithSecurity')`**.

Shape: `{ data: "<JSON string>", expiration: ... }` — parse `data` again as
JSON to get a `member` object. Relevant fields (values are per-account, do
not hardcode real examples in code/docs):

```
member.roleName                    → the security role (use for role rules)
member.defaultGroup.description    → ConnectWise's "Group" = our department
member.defaultLocation.description → office/location (bonus, unused so far)
member.defaultTerritory.description→ territory (bonus, unused so far)
member.isAdmin                     → boolean
member.persona                     → broader persona/license tier
member.memberID                    → clean human-readable identifier (e.g.
                                       "MattO") — use this for "User" field
                                       in Teams/email reports
member.firstName / lastName / fullName / emailAddress → PII, avoid logging
```

This is read directly and synchronously — **no MAIN-world fetch/XHR
sniffing needed** (the originally-planned `inject.js` approach is
unnecessary; localStorage is shared between the page and isolated-world
content scripts).

Secondary confirming source: global `window.mng_profile.securityRole` (same
value, different object) — useful as a fallback/cross-check.

**Do not use** `sessionStorage.currentMember` — looked cookie/session-token
shaped, was auto-blocked by tooling when inspected, never confirmed safe or
useful. Avoid it as a data source.

Manual override in the extension popup remains the safety net regardless.

---

## 4. Pod persistence — confirmed mechanism

Pod layout (which pods are docked) is a **real, per-member, per-screen-type,
server-persisted preference** — confirmed by dragging/configuring pods and
reloading the full page; changes survived.

Endpoints (same-origin, session-cookie-authenticated, NOT the public
documented REST API, NO API keys involved):

```
POST .../services/system_io/actionprocessor/System/GetMemberPodLayoutConfigurationAction.rails
POST .../services/system_io/actionprocessor/System/UpdateMemberPodLayoutConfigurationAction.rails
POST .../services/system_io/actionprocessor/System/GetMemberScreenLayoutAction.rails
POST .../services/system_io/actionprocessor/System/UpdateMemberScreenLayoutAction.rails
```

**All payloads are a single form field `actionMessage`** containing an
opaque **GWT-RPC serialized blob** (not JSON, not readable form data) tied to
a versioned serialization policy specific to the compiled build. Directly
crafting/replaying this payload was evaluated and **rejected** — too fragile
(breaks on any ConnectWise version update), too much reverse-engineering
for the value. Full rationale: `../decisions/0002-extension-never-touches-cw-credentials.md`.

### How pods actually get added (confirmed working sequence)

Native UI: gear icon (`cw_ToolbarButton_Settings`) → "Pod Configuration" →
two-column picker (`cw-dual-list-view-from-list` / `-to-list`) → click an
item to select it (`.mm_label`, gets `x-view-highlightrow`) → click
`.cw-dual-list-view-right-button` → click Save. This fires exactly one
`UpdateMemberPodLayoutConfigurationAction.rails` call and ConnectWise's own
code builds the correct payload — we never touch the wire format.

**Critical constraint, confirmed by direct test:** this sequence only works
with **trusted (real) input events**. A fully-synthetic `dispatchEvent`
sequence (correct target, correct coordinates, correct event order,
`mouseover`→`mousedown`→`mouseup`→`click`) successfully selected the list
item (cosmetic `highlightrow` class applied) but **did not trigger the move
button's action**. A normal content script can only dispatch synthetic
(`isTrusted: false`) events, so **this cannot be automated by a standard
content script**. Confirmed conclusively — do not re-attempt this
assumption without new evidence.

Viable paths evaluated:
- `chrome.debugger` API (CDP-level trusted-equivalent input) — works, but
  requires the `debugger` permission and shows a persistent "this extension
  is debugging your browser" banner while attached. **Chosen approach: use
  this only for brief, user-initiated bursts (§6), never ambiently.**
- GWT-RPC replay — rejected (see above).
- Guided wizard (highlight the right items, let the human click) — always
  available as a fallback if the debugger approach proves too heavy in
  practice.

---

## 5. Rule engine model (hide/show/reorder for static chrome)

- Rules keyed by role, with an optional `_department:<name>` base layer
  applied before role-specific rules.
- Rule shape per role: `{ hide: [selectors], show: [selectors], order:
  [{selector, order}], move: [{selector, targetSelector, position}] }`.
- `order` rules only work within flex/grid containers (nav bars, toolbars).
  Pods need `move` rules instead (see §2).
- Applied via a generated `<style>` block (hide/order) plus direct DOM
  moves (`move`), re-applied on a debounced `MutationObserver` to survive
  ConnectWise's SPA route changes.
- **Rules JSON needs to be shaped per screen type, not just per role** —
  confirmed pod layout is per-screen-type (Ticket vs. Configuration vs.
  etc. each have independent expected-pod sets). Factor this into the
  schema before building the real rules file — not yet finalized
  (`INIT-0004`).

### Rule authoring workflow

- **Design Mode** (click-to-select, generates selectors, assigns
  hide/show/order actions) is a **build-time tool only**, used on a
  dedicated staging-connected profile. It must never run "live" writing
  directly into a production install's `chrome.storage.sync`, because that
  key is also being overwritten by the periodic remote-config poll (see
  §7) — the two would fight each other.
- Workflow: build/test rules with Design Mode on staging → export JSON →
  commit to the repo → publish to the hosted URL → all deployed installs
  pick it up on next poll (~30 min).
- Production installs only ever *read* from the hosted rules JSON. Local
  `chrome.storage.sync` is for personal overrides/troubleshooting only,
  never the durable record of policy.

> **Direction of travel:** this manual Design-Mode-export → commit-to-repo
> workflow was the planning-phase design. The intent now is to front rule
> authoring/distribution with the **CAST web app** (its own sibling
> component in this monorepo) instead of hand-editing
> and committing JSON. Not yet designed — tracked as `INIT-0008`. The
> confirmed facts above (hosted JSON, read-only production installs, why
> `chrome.storage.sync` isn't the durable record) still hold regardless of
> what authors the JSON.

---

## 6. Missing-pod detection & resolution banner

Design (not yet built):

1. On page load / SPA navigation (same `MutationObserver` hook as the rule
   engine), scan currently-docked pods via `pod_*` classes and diff against
   an "expected pods for this role + screen type" list (part of the rules
   config, per §5).
2. If the diff is non-empty, show a dismissible banner: *"Dependent pods
   have not been added. Click here to resolve."* + Dismiss, with a
   snooze-duration option (`INIT-0003`).
3. On "resolve": attach `chrome.debugger` to the tab, drive the confirmed
   sequence (§4) for each missing pod, click Save, detach immediately. The
   debugger banner is only ever live for this brief window — never
   ambient/background.
4. No extra persistence/tracking needed on our side: ConnectWise's own
   per-member, per-screen-type pod storage (§4) is already durable. If a
   user later removes a pod, the same diff-on-load check in step 1 simply
   re-detects the gap and re-shows the banner naturally.

---

## 7. Central config & deployment

- **Hosting**: a public but deliberately **unlisted** static host for
  CI-generated build output only (never source) — candidates: a storage
  bucket/container (S3, Azure Blob, Cloudflare R2) with directory listing
  disabled, or GitHub Pages from an artifacts-only repo. Exact mechanism
  not yet chosen — `INIT-0001`. (Superseded from the planning-phase idea of
  hosting straight off `raw.githubusercontent.com` in a public source
  repo — see `../decisions/0004-monorepo-with-artifacts-only-public-surface.md`.)
  Content here (CSS selectors, role names) is low-sensitivity. No API
  credentials of any kind live in this repo or the packaged extension.
- **Layout**:
  ```
  dist/triton-view-manager.crx
  dist/update-manifest.xml
  rules/rules-stable.json
  rules/rules-canary.json   (optional staged rollout; both live on `main`,
                              promoted via normal PR/diff, not branches)
  ```
- **`manifest.json` must include `update_url`** pointing permanently at the
  hosted `update-manifest.xml` path — this is what Chrome actually uses for
  *subsequent* updates (the registry-set URL is only consulted for the
  *first* install). Get this right before the first real package ships;
  changing it later means existing installs won't find the new location.
- **Extension identity**: pack with `chrome.exe --pack-extension`, keep the
  generated `.pem` private key durable and backed up — losing it changes
  the extension ID on every rebuild.
- **Permission model**: `optional_host_permissions` + a domain entered in
  Options, requested via `chrome.permissions.request` for that one domain
  only. Never a static broad host match.
- **Deployment**: Pulseway script
  (`deployment/Deploy-TritonViewManager.ps1` in the earlier scaffold) sets
  `HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist` directly
  — no Google Workspace, no Intune required. GPO (with Chrome ADMX
  imported into the domain's Central Store) is a documented fallback if
  tamper-resistance (GPO reapplies on every policy refresh) becomes
  necessary — not yet needed/tested (`INIT-0006`). Org is AD-joined,
  satisfying Chrome's requirement for non-Web-Store force-install on
  Windows.
- **No credentials in the extension, ever** — reinforced by the org's own
  API Getting Started guide, which specifies public/private keys must be
  stored server-side, encrypted, never committed to source. This extension
  intentionally needs none: role detection reads localStorage already
  present in the user's session; pod actions use the user's own
  already-authenticated session, not a separate credentialed API.

---

## 8. Breakage & issue reporting

- **Automated breakage detection**: rule engine should track, per selector,
  whether it matched zero elements, and report it — signal ConnectWise
  changed something. Not yet built (`INIT-0005`).
- **User-reported issues**: "Report a problem" button in the popup.
- **Both route through a single Teams webhook**, differentiated by subject
  line prefix and body content so they're distinguishable at a glance:
  ```
  Subject: [Triton VM] Breakage — <role> — <domain>
     or:   [Triton VM] User report — <role> — <domain>
  ```
  Body includes: User (member.memberID), Role, Department, PSA domain,
  Page URL, Timestamp, and either the failed selector(s) or the user's
  typed description.
- **Throttling**: automated breakage reports should dedupe to ~1 per unique
  selector+role per day, to avoid flooding the channel from repeated
  MutationObserver re-checks. User reports don't need throttling (one
  deliberate click each).
- **Known trade-off, accepted**: the Teams webhook URL is unauthenticated
  and lives in a publicly-downloadable `.crx` — spam/spoofing risk only (no
  data-read risk). Accepted as low-severity; regenerate the webhook if
  abused.

---

## 8.5 Multi-browser: Chrome + Edge (committed), Firefox + Shift (not yet)

**Committed scope: Chrome and Edge.** Both are Chromium — same extension
platform, same APIs (`chrome.storage.managed`, `chrome.alarms`, manifest
format), same `.crx` packaging, same `gupdate`-format update-manifest XML,
same `extension_id;update_url` force-install policy syntax. One build, one
packaging pipeline. What differs: separate registry namespaces
(`Policies\Google\Chrome` vs `Policies\Microsoft\Edge`, both for
`ExtensionInstallForcelist` and for the `3rdparty` managed-storage policy
used in `extension-telemetry-and-identity.md`). Both browsers reportedly
need `"override_update_url": true` set in their respective `ExtensionSettings`
policy for reliable ongoing updates — not just `update_url` in the
manifest — build this in from the start rather than debugging it later.
Extension ID is very likely identical across both (derived from the
signing key's public-key hash the same way in both browsers) but not yet
empirically confirmed.

**Deployment: one mechanism, two triggers — not two mechanisms.** Rather
than a separate "on-demand" distribution channel, build a single
registry-policy-writing script (per browser) and trigger it two ways:
Pulseway pushing it at scale, or a user running it themselves on demand.
Either way it just writes that one machine's/user's force-install (and
managed-storage) registry values — the browser then force-installs/updates
automatically within minutes, no separate packaging or install path needed.

**Not committed — deferred:**
- **Firefox** (`INIT-0010`) — a genuinely separate effort, not shared with
  Chrome/Edge: different engine (Gecko), different package format (`.xpi`),
  mandatory Mozilla signing (unless committing to the Firefox ESR channel
  with a signature-bypass policy), and a different policy-delivery
  mechanism (`policies.json`, not a browser-vendor registry namespace).
  Mozilla's own recommended path for this use case — a **self-distributed**
  signed listing on addons.mozilla.org, installed via a link on an internal
  webpage — maps well onto the "on-demand" trigger and doesn't need
  Firefox ESR or registry policy tricks at all.
- **Shift** (`INIT-0011`) — Chromium-based and confirmed to support
  installing Chrome Web Store extensions, but there's no confirmed evidence
  it honors the same enterprise force-install/self-hosted-update mechanism
  this design relies on. Not engineered for; a happy accident if it works,
  not a target.

## 9. Open TBDs

Tracked as initiatives rather than left inline — see `Initiatives-Open.md`:
- `INIT-0003` — Snooze duration options for the missing-pods banner's
  "Dismiss" control.
- `INIT-0004` — Exact per-screen-type expected-pod list schema in the rules
  JSON.
- `INIT-0005` — Whether/when to add structured breakage logging (e.g. Azure
  Function) beyond the Teams webhook, if volume grows.
- `INIT-0007` — Icon/branding assets (current icons are placeholder-generated).
- `INIT-0006` — GPO deployment path — documented as fallback, not yet
  needed/tested.

---

## 10. Practical notes for continued live-instance testing

- **Never click an ambiguous/unlabeled toolbar element without visually
  confirming it first.** A near-miss occurred where an unlabeled "find"
  result turned out to be the ticket's delete/trash icon, not the intended
  gear/settings icon — they sit close together in the ticket toolbar. Zoom
  and visually confirm before clicking anything in a dense icon toolbar,
  especially anything that could plausibly be destructive.
- **Never proceed past a delete/destructive confirmation dialog** without
  explicit, specific approval for that exact action.
- Watch for a **coordinate-space mismatch** between `getBoundingClientRect()`
  (page CSS pixels) and browser-automation screenshot/click coordinates —
  observed a real scaling factor (~0.87–0.92, varies with window/viewport
  size) between them in this environment. Prefer element-reference-based
  clicking over raw computed pixel coordinates when available.
- Network-request browser tooling did not reliably capture this app's
  traffic (both top-level and nested-iframe attempts came back empty);
  what worked was injecting a `PerformanceObserver` / patched
  `fetch`/`XMLHttpRequest` directly into the page context and reading
  `window.performance.getEntriesByType('resource')` for URLs, then
  patching `fetch`/`XHR` for actual request bodies.

---

## 11. Naming & the toolbar popup (added 2026-07-23)

**Naming:** the product is the **CAST Browser Extension** — drop the old "View
Manager" / "Triton View Manager" name everywhere (folder, docs, copy). In the
browser toolbar (by the address bar) it shows simply **"CAST"** with the **Triton
trident icon** (`INIT-0007`).

**Popup (click the toolbar icon)** — a small branded modal showing:
- **Detected user:** `First Last (cwMemberID)` — from the localStorage session
  read (§3): `member.fullName` (or first/last) + `member.memberID`.
- **Position** — the CW security role (`member.roleName`).
- **Department** — `member.defaultGroup.description`. **If enabled for that user
  in the CAST app**, Department is a **dropdown** letting them pick a *different*
  Department to preview/apply that Department's view customization (the per-user
  "may switch department" flag comes from the app config / check-in response).
- **Extension version** — `chrome.runtime.getManifest().version`.
- **Last sync** — timestamp of the last *successful* check-in with the CAST app
  server (the staleness timestamp from `extension-telemetry-and-identity.md` §1).

This popup is also the natural home for the manual role/department override
(§3's safety net) and the "Report a problem" button (§8).
