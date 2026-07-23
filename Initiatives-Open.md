# Initiatives — Open

Ideas we intend to (or might) implement, not yet shipped. **Nothing is forgotten here.**

How this file works (full process: `knowledge/conventions/initiatives.md`):
- **Captured** when the user says they're planning something, OR when Claude suggests something the user doesn't explicitly decline.
- **Fleshing-out** — details recorded here *before* implementation.
- When **implemented**, the entry is **moved to `Initiatives-Complete.md`** with what was built and how we got there.
- **Review this file before starting any new idea/process** so we always develop with the known future in mind.

Entry template: `knowledge/templates/initiative.md`. IDs are stable and never reused.

---

### INIT-0001 — Stand up the extension's public artifacts host + rename
- **Status:** Fleshing-out · **Source:** User · **Added:** 2026-07-18 · **Revised:** 2026-07-18
- **Serves:** The extension's Chrome auto-update mechanism (`update_url` + `.crx` fetch) is the *only* thing requiring anything public at all — per `knowledge/decisions/0004-monorepo-with-artifacts-only-public-surface.md`, the extension's source stays in this private monorepo (`components/browser-extension/`); only CI-generated build output goes public.
- **Idea:** Set up an automated release step that publishes just the packaged `.crx`, `update-manifest.xml`, and the runtime rules JSON to a public host, to an **unlisted** destination (no repo browsing UI, no org listing, no links pointing to it) rather than a public GitHub repo — since there's no external-contribution use case to justify that visibility. Naming is now settled: **CAST**, same brand as the web app (previously "Triton View Manager for ConnectWise" during planning, and `TritonTechnical-BusinessSystems/TritonViewManagerForPSA` before that).
- **Fleshing-out notes:** **SIMPLIFIED 2026-07-24 — served from the app, no separate host.** Extension users are on Triton's internal network (same as the web app), and Chrome/Edge fetch the update manifest + `.crx` *from the user's browser* — so they reach **cast.tritontechnical.com** directly; the "publicly-fetchable host" premise was over-cautious for internal-only users. `update_url` is now `https://cast.tritontechnical.com/api/extension/update.xml` (`@cast/api` `routes/extension.ts` serves the gupdate manifest + `/cast.crx`). So this initiative is no longer "stand up a host" — it's just the **CRX build + sign step**: pack the extension with the signing key → `components/browser-extension/deploy/cast.crx` and bump the version in the update manifest. (Original external-host candidates kept below only if off-network users ever need them.) Legacy hosting candidates: a storage bucket/container (S3, Azure Blob, Cloudflare R2) with directory listing disabled, or GitHub Pages from a repo containing only build output. Whatever is chosen, `manifest.json`'s `update_url` must point at it permanently before the first real package ships (changing it later strands existing installs — see `knowledge/architecture/browser-extension.md` §7). A network-restricted (VPN/IP-allowlisted) host was considered as a stronger-privacy upgrade but held back as a future option, not the default — see ADR-0004's consequences. **Now covers both Chrome and Edge** (`knowledge/architecture/browser-extension.md` §8.5): separate registry namespaces and `override_update_url` policy needed for each, but likely one shared packaging/artifacts pipeline. Firefox and Shift are explicitly out of this initiative's scope — see `INIT-0010`/`INIT-0011`.
- **Related:** `knowledge/architecture/browser-extension.md`, `knowledge/decisions/0002-extension-never-touches-cw-credentials.md`, `knowledge/decisions/0004-monorepo-with-artifacts-only-public-surface.md`.

### INIT-0002 — Scheduled data-sync component
- **Status:** Captured · **Source:** User · **Added:** 2026-07-18
- **Serves:** The second named component of CAST's north star — capability ConnectWise doesn't natively provide, via server-side credentialed API access (never client-side, per `knowledge/decisions/0002-extension-never-touches-cw-credentials.md`).
- **Idea:** Component(s) that run on a schedule, gather data from the internet, and update the Triton ConnectWise instance via its API.
- **Fleshing-out notes:** Not yet designed — no target data sources, schedule cadence, or API scope decided yet. Likely lives in this repo (private) rather than a separate one, per the repo-structure decision. Sibling component to `INIT-0008` under the same eventual CAST web app. **First concrete use case:** `INIT-0012` (Vessel Location Updating) — everything decided there (external lookup → CW company custom field match → CW site address update, on a schedule) is this initiative's first real instance, and should inform the general scheduled-job/credential-handling shape when it's eventually designed.
- **Related:** `INIT-0008`, `INIT-0012`.

### INIT-0003 — Snooze duration options for the missing-pods banner
- **Status:** Captured · **Source:** User (open TBD from the extension's design record) · **Added:** 2026-07-18
- **Serves:** CAST's missing-pod resolution banner (`knowledge/architecture/browser-extension.md` §6).
- **Idea:** Decide the snooze-duration choices offered on the banner's "Dismiss" control.
- **Fleshing-out notes:** Not yet designed.
- **Related:** `knowledge/architecture/browser-extension.md`.

### INIT-0004 — Per-screen-type expected-pod schema
- **Status:** Captured · **Source:** User (open TBD from the extension's design record) · **Added:** 2026-07-18
- **Serves:** The rule engine and missing-pod detection both need this schema (`knowledge/architecture/browser-extension.md` §5–6).
- **Idea:** Finalize the exact schema for "expected pods per role + screen type" in the rules JSON — confirmed pod layout is per-screen-type, not just per-role, so the schema must express that.
- **Fleshing-out notes:** Not yet finalized.
- **Related:** `knowledge/architecture/browser-extension.md`.

### INIT-0005 — Structured breakage logging beyond the Teams webhook
- **Status:** Captured · **Source:** User (open TBD from the extension's design record) · **Added:** 2026-07-18
- **Serves:** Operational visibility into rule-engine breakage as ConnectWise changes its UI (`knowledge/architecture/browser-extension.md` §8).
- **Idea:** Add structured logging (e.g. an Azure Function) beyond the current Teams webhook, if breakage-report volume grows.
- **Fleshing-out notes:** Not yet needed at current scale; revisit if the Teams channel gets noisy.
- **Related:** `knowledge/architecture/browser-extension.md`.

### INIT-0006 — GPO deployment path (fallback)
- **Status:** Captured · **Source:** User (open TBD from the extension's design record) · **Added:** 2026-07-18
- **Serves:** Tamper-resistant deployment fallback if the Pulseway-driven registry forcelist proves insufficient.
- **Idea:** Document/test deploying the extension forcelist via GPO (Chrome ADMX imported into the domain's Central Store) instead of the direct registry-key Pulseway script.
- **Fleshing-out notes:** Documented as a fallback only; not yet needed or tested. Org is already AD-joined, so this is viable whenever it's needed.
- **Related:** `knowledge/architecture/browser-extension.md`.

### INIT-0008 — CAST web app (centralized configuration UI)
- **Status:** In progress (scaffolded) · **Source:** User · **Added:** 2026-07-18 · **Revised:** 2026-07-19
- **Serves:** Replaces the extension's planning-phase manual "Design Mode export → commit JSON → host on GitHub raw URL" workflow (`knowledge/architecture/browser-extension.md` §5) with a real centralized configuration surface. Always developed in lockstep with the extension — this pairing is why CAST is one monorepo (`knowledge/decisions/0004-monorepo-with-artifacts-only-public-surface.md`), alongside the scheduled data-sync component (`INIT-0002`).
- **Idea:** A web-based interface for centrally configuring the extension's role/department rules (hide/show/reorder/move, expected-pod lists) instead of hand-editing and committing JSON.
- **Fleshing-out notes:** **Hosting settled:** internal Linux VM, deployed via Docker, reachable at `cast.tritontechnical.com`. Tech stack itself still undecided (`INIT-0002`'s sibling — likely shares a stack once one is chosen). The real design question is the **config schema** shared between this app (author) and the extension (consumer). Not yet decided: where the schema is defined/versioned, and how this app pushes an updated config out to the extension's public artifacts host (`INIT-0001`) — presumably the same release step that publishes the `.crx`. Also now covers: the reachability/timestamp-based staleness banner design and the `chrome.storage.managed` device/OS-user identity mechanism (explicitly **not** `chrome.identity.getProfileUserInfo()` — unreliable, tied to whatever personal/work account a user signs into the browser profile with) — full design in `knowledge/architecture/extension-telemetry-and-identity.md`. That file also serves the check-in catalog (`INIT-0009`).
  **Auth model settled (direction), mechanism open:** primary login is against Triton's internal/on-prem Active Directory, gated by membership in a specific AD security group (canonical name TBD — placeholder "CAST-Users" used in the mockup) — anyone outside that group is denied even with valid AD credentials. A **local account** login path (credentials stored directly in the app, independent of AD) exists as a fallback for when the AD integration itself is unreachable/broken, not as a general-purpose alternative — should be visually secondary to the AD path, not an equal-weight choice, and likely restricted to a small break-glass admin set rather than provisioned per ordinary user. **Open question, not yet decided:** the actual AD integration mechanism — options include a direct LDAP(S) bind against a domain controller, Windows Integrated Auth (Kerberos/NTLM) if the app sits fully inside the domain network, or federating through Entra ID/ADFS if Triton's on-prem AD is already synced to Entra ID. Since the app is Docker-hosted on an internal Linux VM (not Windows), LDAPS bind is the most likely low-friction fit but this needs infrastructure input before committing. Local-account password storage must follow standard secure practice (hashed + salted, e.g. bcrypt/argon2) regardless of which AD mechanism is chosen.
  **Information architecture settled (mockup):** the extension's config surfaces (role rules, expected-pod schema, fleet/check-in catalog, deployment/publish controls) live as **tabs on one "CAST Extension" page** inside this app, not separate top-level nav items. First mockup pass: `knowledge/architecture/cast-web-app-mockup.md`.
  **Stack chosen + scaffolded (2026-07-19, corrected 2026-07-20):** pnpm + turbo TypeScript monorepo (mirroring Limnode). Web app = **Vite React SPA** (`components/web`) + **Express API** (`components/api`, run via tsx) + shared `@cast/config-schema` (`packages/config-schema/`); JWT-httpOnly-cookie auth (AD LDAPS + CAST-Users gate, local bcrypt fallback), `node-cron` vessel-sync stub; deploy via nginx + docker-compose (SOC-style). Decision: `knowledge/decisions/0006-web-app-stack-vite-react-express.md` (supersedes `0005` — SvelteKit was picked before checking that the org standardizes on Vite+React+Node per SOC/Limnode). Scaffold typechecks/builds/runtime-verified (all protected routes 401 without a session). Deploy host `trt-cast-01` provisioned (`knowledge/architecture/cast-web-app-vm-provisioning.md`).
  **Remaining before this is real:** persistent stores for local break-glass accounts / config+check-in catalog (currently in-memory/stubbed — SOC uses better-sqlite3, a likely fit); build out the four extension tabs + vessel table against the mockup; run the AD bind against live AD and confirm the mechanism; resolve the VM's VLAN-egress blocker; add TLS at the deploy edge.
- **Related:** `knowledge/architecture/browser-extension.md`, `knowledge/architecture/extension-telemetry-and-identity.md`, `knowledge/architecture/cast-web-app-mockup.md`, `knowledge/architecture/cast-web-app-vm-provisioning.md`, `knowledge/decisions/0004-monorepo-with-artifacts-only-public-surface.md`, `knowledge/decisions/0006-web-app-stack-vite-react-express.md`, `INIT-0001`, `INIT-0002`, `INIT-0009`, `INIT-0012`.

### INIT-0009 — Extension check-in catalog
- **Status:** Fleshing-out · **Source:** User · **Added:** 2026-07-18
- **Serves:** Fleet visibility for the CAST web app — knowing which machines/users are running the extension, on what version, and how recently, without waiting for someone to report a problem.
- **Idea:** Each installed extension instance periodically reports itself to the CAST web app: browser, device identifier, OS account name, CW user, extension version, settings/rules version. The server records its own receipt time as "last check-in" — free, no client tracking needed.
- **Fleshing-out notes:** Full field list and sourcing: `knowledge/architecture/extension-telemetry-and-identity.md` §3. Check-in interval likely shares the rules-refresh `chrome.alarms` cadence rather than being a separate schedule. Depends on `INIT-0008`'s config-schema/backend work and the device/OS-user identity mechanism in the same architecture doc.
- **Related:** `knowledge/architecture/extension-telemetry-and-identity.md`, `INIT-0008`.

### INIT-0010 — Firefox support
- **Status:** Captured · **Source:** User · **Added:** 2026-07-18
- **Serves:** Broader browser coverage beyond the committed Chrome+Edge scope, if/when there's demand.
- **Idea:** Port the extension to Firefox. Explicitly deferred — not part of the current committed scope (`knowledge/architecture/browser-extension.md` §8.5).
- **Fleshing-out notes:** Genuinely separate effort, not a recompile: different engine (Gecko vs Chromium), different package format (`.xpi` vs `.crx`), mandatory Mozilla signing unless committing to Firefox ESR + a signature-bypass policy, and a different policy-delivery mechanism (`policies.json`, not a registry namespace). Mozilla's own recommended path — a self-distributed signed AMO listing, installed via a link on an internal webpage — fits the "on-demand" deployment trigger well and avoids needing ESR or registry tricks at all.
- **Related:** `knowledge/architecture/browser-extension.md`.

### INIT-0011 — Shift compatibility (opportunistic only)
- **Status:** Captured · **Source:** User · **Added:** 2026-07-18
- **Serves:** No dedicated engineering effort — recorded so it isn't silently forgotten, not because it's committed scope.
- **Idea:** If CAST happens to work in the Shift desktop app (Chromium-based, confirmed to support installing Chrome Web Store extensions) as a side effect of the Chrome/Edge build, that's a welcome bonus. Not to be actively engineered or tested for.
- **Fleshing-out notes:** No confirmed evidence Shift supports the enterprise force-install/self-hosted-update mechanism this design relies on (it's a small commercial product, not a browser vendor with the same enterprise device-management surface as Google/Microsoft) — would need dedicated verification if it ever becomes a real priority.
- **Related:** `knowledge/architecture/browser-extension.md`.

### INIT-0007 — Icon/branding assets
- **Status:** Captured · **Source:** User (open TBD from the extension's design record) · **Added:** 2026-07-18
- **Serves:** CAST's shipped presentation (Chrome Web Store-style listing, toolbar icon, popup).
- **Idea:** Replace the current placeholder-generated icons with real branding assets, ideally consistent with the CAST brand.
- **Fleshing-out notes:** Not yet started.
- **Related:** `knowledge/architecture/browser-extension.md`.

### INIT-0012 — Vessel Location Updating
- **Status:** Fleshing-out · **Source:** User · **Added:** 2026-07-18
- **Serves:** First concrete instance of the scheduled data-sync component (`INIT-0002`) — capability ConnectWise doesn't natively provide (live vessel position/status), pulled server-side and pushed back into CW via its credentialed API, never client-side. Surfaced as a page inside the CAST web app (`INIT-0008`).
- **Idea:** Each ConnectWise company (client) record that represents a vessel carries a custom field holding its **IMO number** (the vessel's permanent international identifier). On a schedule, for clients in a specific status, resolve each vessel's live AIS data and write back a **human-friendly navigational status** ("Moored / At anchor / Under way") plus an **appropriate friendly location** (nearest port/anchorage, or destination when under way). *(Refined 2026-07-22: the output is friendly status + place name, **not** a street address — so the target is almost certainly two custom fields, not a location record's address field; see the architecture note.)*
- **Fleshing-out notes:**
  - **Data source & legality — DECIDED (2026-07-22): aisstream.io.** A colleague found aisstream.io, a **free, legitimate AIS WebSocket API** — this resolves the original blocker (MarineTraffic's ToS prohibits scraping). Key stored server-side (`components/api/.env`, `CAST_AISSTREAM_API_KEY`). Full model + design consequences captured in `knowledge/architecture/vessel-location-updating-aisstream.md`. **This changes the architecture materially:** it's a *push stream, not a lookup*, so the feature becomes a long-lived WS listener (latest-position cache) + the scheduled writer; positions are keyed by **MMSI not IMO** (IMO only in `ShipStaticData`) so an IMO↔MMSI mapping is needed; positions are lat/lon so an address write needs reverse-geocoding; and AIS nav-status doesn't map 1:1 to docked/moored/dry-docked/underway. See the note for the remaining open sub-decisions. *(Beta, no SLA — acceptable for an internal tool; revisit if reliability bites.)*
  - Remaining open questions, none yet decided:
  - Which CW **company status** makes a client eligible for lookup (e.g. "Active" only?) — not decided.
  - **Vessel identity key (refined 2026-07-23 — fleet is superyachts):** clients are practically all superyachts, and Triton already holds IMOs for many/most → IMO is a reliable key here, and these carry **Class A AIS** (real navigational-status field, so §3.4's clean status mapping applies). **MMSI is still the AIS position key** and is now a CW custom field (added 2026-07-23) — but it's the field most often *missing*, so the reconciliation gap is predominantly **IMO→MMSI** (see `INIT-0014`). See architecture note §3.7.
  - **CW write target (refined 2026-07-22):** output is friendly status + place name, **not** an address — so likely **two custom fields** ("Vessel Status", "Vessel Location") on the company, not a location/site address field. Confirm the exact fields with the user. *(Supersedes the earlier "which location/site's address gets overwritten" question.)*
  - **Fleet scaling (refined 2026-07-23 — clients travel globally):** use a **global bounding box + MMSI filter** (not regional boxes). ≤50 vessels = one subscription; the real limit is one-subscription-per-connection. Preferred: scope the monitored set to the CW-active status (likely ≤50); if it exceeds 50, **rotate on one connection** (swap-and-replace) since writes are scheduled. More API keys ≠ more capacity (throttling is also per-account); a second key is for **isolation** (background monitor vs. ad-hoc lookups), not capacity, and don't split keys by department. See the architecture note §3.6 / §4.
  - Sync **cadence** — not decided.
  - Whether navigational status is stored anywhere in CW (a field/note) or is mockup/web-app-only display — not decided.
  - First mockup pass (client list, status filter, sync action) is in `knowledge/architecture/cast-web-app-mockup.md`.
- **Related:** `INIT-0002`, `INIT-0008`, `INIT-0013`, `knowledge/architecture/cast-web-app-mockup.md`, `knowledge/architecture/vessel-location-updating-aisstream.md`.

### INIT-0013 — In-app secret management (secure API-key entry/update)
- **Status:** In progress (Integrations screen + AES-256-GCM store built; sqlite migration + full store-precedence pending) · **Source:** User · **Added:** 2026-07-22
- **Serves:** Operating CAST without editing files on the box — a secure place in the CAST web app to enter/update integration secrets (starting with the aisstream.io key, later the CW API credentials and the AD service-bind password) instead of hand-editing `components/api/.env` and redeploying.
- **Idea:** An admin-only settings surface in the web app to view (masked) and update API keys/secrets. Values are stored **encrypted at rest** server-side and injected into the services that need them — never returned to the browser in plaintext, never exposed to the SPA.
- **Fleshing-out notes:** **Interim state (now):** secrets live in `components/api/.env`, git-ignored, server-side only — the correct bar for env secrets, but requires a file edit + redeploy to change. This initiative replaces that manual step for the secrets that ops will rotate.
  - Must uphold `knowledge/decisions/0002`: secrets stay server-side; the UI writes/updates but the SPA never receives a plaintext secret back (mask + "replace" semantics only).
  - Needs a persistence + **encryption-at-rest** decision (envelope encryption / a key from the host env or a secrets manager — a plain DB column is not sufficient). Ties to whatever store INIT-0008 picks (e.g. better-sqlite3).
  - Gate behind the strongest auth tier (admin / break-glass), not ordinary CAST Users.
  - Precedence rule needed: in-app-stored value vs. `.env` value — which wins, and how a service picks up a change without a restart.
- **Related:** `INIT-0008`, `INIT-0012`, `knowledge/architecture/vessel-location-updating-aisstream.md`, `knowledge/decisions/0002-extension-never-touches-cw-credentials.md`.

### INIT-0014 — Vessel identity reconciliation & enrichment (backend interface)
- **Status:** In progress (frontend page + live ManageCwClient reads working; CW writes GATED pending user approval) · **Source:** User · **Added:** 2026-07-23
- **Serves:** Data quality for Vessel Location Updating (`INIT-0012`) — ensure every tracked vessel-client has **both IMO and MMSI** in ConnectWise so the aisstream monitor can subscribe by MMSI. The "front door" that seeds the monitored set. Also CAST's **first ConnectWise *write* path** (`INIT-0002`).
- **Idea:** An admin/ops interface in the CAST web app that (1) pulls the vessel-clients we track from CW (the `INIT-0012` status scope), (2) **audits** which have IMO / MMSI / both / neither, (3) for gaps, **looks the vessel up** against a vessel-registry source and, on **operator confirmation**, writes the missing identifier(s) back to the CW custom fields.
- **Fleshing-out notes:**
  - **Fleet is superyachts; IMO present for many/most → the dominant gap is IMO→MMSI** (fill missing MMSI). MMSI custom field added in CW 2026-07-23.
  - **Lookup source — DECIDED 2026-07-23: free + app-assisted operator lookups** (no paid API). aisstream can't do IMO→MMSI (wrong direction). Instead the app generates a **prefilled deep-link** to a free registry (Equasis / ITU MARS) for the operator to view, then **validates and writes** what they paste back. No cost; a human clicking through is ToS-safe (no automated scraping). Paid registry APIs remain a future upgrade if volume grows.
  - **PREREQUISITE — CAST's first credentialed ConnectWise API integration (`INIT-0002`):** read companies + custom fields, write them back. Doesn't exist yet; this is the bigger lift and the **gate**. **DECIDED 2026-07-23: build against a clean stubbed CW client now, wire the real instance once keys are issued.** CW creds server-side only (`knowledge/decisions/0002`). **CW access to create (checklist):** (1) a dedicated **API Member** (Members → API Members) — not a real user; (2) a least-privilege **Security Role** — Companies Inquire+Edit (covers company custom fields), Company/Site Inquire (+Edit later for site writes); (3) **public/private API keys** on that member (private shown once → server-side secret); (4) a **clientId** GUID registered at the ConnectWise Developer Network; (5) connection details — **site URL** (e.g. `https://<region>.myconnectwise.net`), **companyId** (tenant), API version; (6) the **IMO + MMSI custom-field IDs/captions** on the Company record; (7) which company **status/type** scopes a tracked vessel-client.
  - **Human-in-the-loop (design law):** never auto-write an ambiguous/fuzzy name match; operator confirms each identity (name / flag / callsign) before the write.
  - **Free, dependency-free first line:** validate **IMO check digit** (7th digit) + **MMSI format** (9 digits, MID prefix) locally to catch typos/transpositions instantly; once looked up, cross-check the IMO↔MMSI pair belong to the same vessel. Buildable today, independent of the two open decisions.
  - If the lookup source is a paid API, its key is another server-side secret → ties to `INIT-0013`.
  - **Progress (2026-07-23) — backend scaffolded + verified.** `components/api/`: `vessels/identifiers.ts` (IMO check-digit + MMSI format validation, pure/authoritative), `vessels/registryLinks.ts` (app-assisted free deep-links, IMO→MMSI), `connectwise/client.ts` (`CwClient` interface + in-memory `StubCwClient` seeded with illustrative superyachts incl. the real gaps), `routes/vesselIdentity.ts` (`GET` audit + validated `POST` write-back, `requireAuth`, mounted `/api/vessel-identity`). Typecheck + smoke pass (check-digit catches a seeded typo; write-back guard rejects malformed input). **Still stub CW.**
  - **Real CW client — model on LogisticsCoordinator.** LC has *live* CW API connectivity; `ManageCwClient` will replicate its auth/base-URL/company-customField read+write pattern (agent extracting it). User is issuing a **new dedicated API member** for CAST (permissions may be partial at first, adjust as we go).
- **Related:** `INIT-0002`, `INIT-0008`, `INIT-0012`, `INIT-0013`, `INIT-0015`, `knowledge/architecture/vessel-location-updating-aisstream.md`, `knowledge/architecture/connectwise-api-integration.md`, `knowledge/decisions/0002-extension-never-touches-cw-credentials.md`.

### INIT-0015 — Vessel Tracking Configuration (dynamic followed-set selection)
- **Status:** In progress (screen + live-CW statuses/boards options + preview built; board/open-ticket criterion + persistence-to-sqlite TODO) · **Source:** User · **Added:** 2026-07-23
- **Serves:** The control surface for *which* vessels CAST follows/syncs — replaces the static single-status env scoping (`CW_TRACKED_STATUS`) with a configurable, CW-queried rule. Defines the working set the aisstream monitor subscribes to (`INIT-0012`) and the reconciliation audits (`INIT-0014`). A config surface inside the CAST web app (`INIT-0008`).
- **Idea:** A **Vessel Tracking Configuration** page presenting CW-queryable criteria as selection checkboxes whose combination defines the tracked (followed/synced) vessel set: (1) **Company Status**; (2) **Has IMO / Has MMSI** recorded; (3) **Has open projects/tickets on specific boards**. The checkbox *options themselves are queried live from CW* (statuses, boards) — nothing hardcoded. A **live preview** shows matching vessels + count as criteria toggle. The saved rule is persisted (`INIT-0008`/`0013` store) and drives the monitor + reconciliation.
- **Fleshing-out notes:**
  - **CW query shapes:** statuses `GET /company/companies/statuses`; boards `GET /service/boards` + `GET /project/boards`; candidates `GET /company/companies?conditions=status/name in (...)` + `customFieldConditions`; open work `GET /service/tickets?conditions=board/id in (...) AND closedFlag=false` (and project equivalent) → collect distinct company ids → intersect. The board/ticket query is the heaviest — query open tickets *by board* and intersect with the status/custom-field candidate set rather than per-company. Validate all shapes against live CW before building.
  - **Combination logic (proposed, confirm at build):** AND across the three groups, OR within each group's checkboxes.
  - **"Has MMSI" is a HARD requirement, not just a filter** — the monitor subscribes by MMSI, so a vessel without one can't be tracked regardless. The followed set is implicitly gated by a valid MMSI; `INIT-0014` feeds it.
  - **The board/ticket criterion makes the set DYNAMIC** — vessels enter/leave as engagements open/close. Powerful (tracking auto-follows active work) but the monitor's MMSI subscription must **refresh from this rule on a schedule** (ties to the aisstream subscription-refresh design, `vessel-location-updating-aisstream.md` §3.6).
  - Add a **manual pin/exclude override** layer on top of the rule (always-follow / never-follow a specific vessel).
  - **Naming:** canonicalize as **Tracked Vessel** / **Vessel Tracking Configuration** → add to `knowledge/conventions/naming-lexicon.md` (avoid synonyms followed/synced/monitored).
  - **Depends on:** live CW connectivity (clientId pending) to validate query shapes; the design-system foundation; the persistence store. Build as a screen after the foundation, alongside CW Integrations + reconciliation.
- **Related:** `INIT-0002`, `INIT-0008`, `INIT-0012`, `INIT-0013`, `INIT-0014`, `INIT-0016`, `knowledge/architecture/connectwise-api-integration.md`, `knowledge/architecture/vessel-location-updating-aisstream.md`.

### INIT-0016 — System Health page (like LogisticsCoordinator)
- **Status:** In progress (page + `/api/health/full` integration probes built; host CPU/mem/disk gauges TODO) · **Source:** User · **Added:** 2026-07-23
- **Serves:** Operational visibility — one page showing the health of CAST's dependencies/integrations so problems surface before someone reports them. Models LC's "System Health" page (System nav section).
- **Idea:** A **System Health** page surfacing live green/amber/red status for: the **CW API** connection (reachable / auth / permission warnings — e.g. the statuses/boards Security gaps found 2026-07-23); the **aisstream** monitor (connected, last-message age); **AD/LDAPS** bind; the **vessel-sync** job (last/next run); the datastore; and build/version + uptime.
- **Fleshing-out notes:**
  - Natural home for the integration statuses we're wiring — e.g. surface the CW role permission gaps (`INIT-0015`) *live in the UI* instead of discovering them via curl.
  - Model on LC's System Health page (investigate its exact contents/layout at build time).
  - Built on the design-system foundation from shared primitives (status cards / dots / badges) — a first-class screen, not ad-hoc.
  - Backend: a `/api/health/*` aggregation (extends the current `/api/health`) that probes each dependency.
- **Related:** `INIT-0008`, `INIT-0012`, `INIT-0013`, `INIT-0014`, `INIT-0015`, `knowledge/architecture/connectwise-api-integration.md`, `knowledge/architecture/extension-telemetry-and-identity.md`.

### INIT-0017 — Geo Alerts (vessel geofencing → CW action)
- **Status:** In progress (config surface built) · **Source:** User (evolved from the refit-signals idea) · **Added:** 2026-07-23
- **Serves:** Capability CW doesn't natively provide — flag/act when a **tracked vessel enters a defined geographic area**. Consumes the aisstream monitor's live positions (`INIT-0012`).
- **Idea:** Define multiple **areas** (circle = center + radius; or bounding box) on a **Geo Alerts** page; when a tracked vessel's position enters an area, fire an **action** (flag in ConnectWise / Teams notification / log). Areas + action persisted; the monitor evaluates point-in-area each position update and triggers on **entry** (edge-triggered).
- **Fleshing-out notes:**
  - **Built now:** config surface — `GET/PUT /api/geo-alerts`, the `GeoAlerts` page, and `vessels/geo.ts` (haversine circle + bbox `pointInArea`/`areasContaining`). Persisted to the settings store.
  - **Runtime (TODO):** the monitor tests each position against areas; on ENTRY (was-outside → now-inside) fire the action. The CW-flag action is a CW write → gated by `CW_WRITES_ENABLED`.
  - **Enhancements:** map-drawing UI for areas (vs. coordinate entry); polygons; per-area actions; dwell/exit triggers; which vessels a given area applies to.
- **Related:** `INIT-0002`, `INIT-0012`, `knowledge/architecture/vessel-location-updating-aisstream.md`.

### INIT-0018 — Shipment / logistics tracking (carrier status → CW)
- **Status:** Fleshing-out · **Source:** User · **Added:** 2026-07-23
- **Serves:** Auto-update delivery status/updates for the logistics team from tracking/waybill numbers — another instance of the scheduled data-sync (`INIT-0002`), same shape as Vessel Location Updating.
- **Idea:** Store tracking/waybill numbers on CW records; pull carrier status (multi-carrier aggregator, webhook-driven) and write delivery status + ETA back into CW, with **proactive exception alerts** to the logistics team.
- **Fleshing-out notes:**
  - **Data source:** a multi-carrier **aggregator** (AfterShip / EasyPost / ShipEngine / Shippo / 17track) — one API, normalized statuses, **webhooks on change** (push, not poll) = the practical choice. Direct carrier APIs (FedEx/UPS/DHL/USPS) only if few carriers. Freight/ocean (project44 / FourKites / **Vizion** by Bill of Lading) if shipping air/ocean freight.
  - **The value is proactive EXCEPTIONS**, not mirroring: flag delayed / held-at-customs / failed-delivery / bad-address → Teams + CW ticket flag. Plus ETA/delay detection, customs milestones, a shipments-in-flight dashboard, close-the-loop on delivery, proof-of-delivery capture.
  - **Next-level:** **fuse with vessel tracking** — parts ship *to a vessel*; combine shipment ETA + live vessel position ("will the part reach M/Y X before it leaves port?"). Capability neither carrier nor CW has.
  - **Placement — DECIDED 2026-07-23: lives in CAST.** (LC stays Triton's logistics app; CAST owns this carrier-status → CW sync.)
  - **Free path:** the carriers' OWN APIs (**UPS / FedEx / USPS / DHL**) are free for account holders — no per-shipment cost; the cost is one adapter per carrier + **polling** (node-cron; no push). Aggregators (AfterShip / EasyPost / 17track) have **free tiers** (low monthly volume) + webhooks but go paid at scale. Freight/ocean (Vizion / project44) are not free. → For a handful of parcel carriers, **direct free APIs + polling = $0** — the recommended start. Carrier creds are server-side secrets (encrypted store, `INIT-0013`).
  - **Scope — outbound first (user 2026-07-23).** *Outbound* = Triton's own carrier accounts → you have the tracking # at label creation + an account with the carrier → **direct free carrier API + poll**. Easy phase 1, $0. *Inbound* is messier + higher-value: ships on **vendors' accounts / any carrier** (an aggregator earns its keep — unknown carrier) AND first requires **capturing the tracking #** (parse vendor emails / PO confirmations — a separate problem). The "will the part reach the vessel in time" fusion is mostly an **inbound** story. Get inbound volume + how tracking #s arrive before scoping it.
  - **Need from user:** which carriers Triton ships *outbound* with (drives the phase-1 adapters); inbound volume (TBD).
- **Related:** `INIT-0002`, `INIT-0012` (same data-sync pattern), the LogisticsCoordinator project.

### INIT-0019 — Vessel photos (attach to CW company / show in CAST)
- **Status:** Fleshing-out · **Source:** User · **Added:** 2026-07-23
- **Serves:** Show each client vessel's photo in CW + CAST (vessel pages, the future live fleet board). Makes the fleet visual. A matter of *how*, not *if*.
- **Idea:** Store a vessel photo on the CW company record and surface it in CAST.
- **Fleshing-out notes:**
  - **Source — preferred: the client / management-company's own official photo** (owned, high quality, zero copyright issue). Attach to the CW company as a document (CW `/system/documents` upload) or a custom-field image.
  - **Do NOT scrape** MarineTraffic / VesselFinder / ShipSpotting — contributor-copyrighted + ToS-restricted (the same trap avoided with MarineTraffic scraping). A "view photos" **link-out** is ToS-safe if wanted.
  - A **licensed vessel-data API** photo field (Datalastic / MarineTraffic) is an option *if* automation is worth the cost and the license permits store/display.
  - **The "how" to decide:** capture flow (a CAST upload UI → CW document, vs. attach directly in CW), storage location (CW document vs custom field vs CAST store), and display surfaces (vessel identity/list pages, the live fleet board).
  - Shines on the **live fleet board** (`Ideas.md`) + vessel pages.
- **Related:** `INIT-0012`, `INIT-0014`, `knowledge/architecture/connectwise-api-integration.md`, `Ideas.md` (live fleet board).
