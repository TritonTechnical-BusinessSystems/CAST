# Changelog

All notable changes to CAST. Format: `knowledge/conventions/changelog-and-releases.md`.

Product version: `MAJOR.MINOR.PATCH.CORRECTION` (MAJOR `0` until `1.0` is declared).
Build stamp: `YYMM###` (year, month, build # within that month). Each entry carries an ISO-8601 UTC timestamp.

Change types: **Added · Changed · Fixed · Removed · Deprecated · Security**.
Category tags: `UX · Frontend · Backend · Database · API · Integrations · Design-System · Docs · Security · Performance · Infra`.

---

## v0.1.4.1 — build 2608004 — 2026-08-07T21:52:34Z

### Changed
- [Infra] `cast-api`'s Dockerfile is now **multi-stage** — the build toolchain (python3/make/g++, needed only to compile `better-sqlite3`'s native module) no longer ships in the production image. Verified the compiled module still loads and outbound HTTPS still works (`ca-certificates` kept in the final stage) before deploying. Image size **1.14GB → 511MB**.
- [Infra] `cast-web`'s Dockerfile copies `version.json` last, right before the one build step that reads it, instead of alongside the other manifests. `version.json` changes on every deploy (build-number bump), so copying it early was busting the `pnpm install` layer's cache on every single deploy even when the lockfile hadn't changed.

## v0.1.4 — build 2608003 — 2026-08-07T21:46:35Z

### Fixed
- [Backend] **API no longer crashes on shutdown.** `better-sqlite3` was crashing with a native assertion (`RemoveEnvironmentCleanupHook`, a `Statement` destructor firing after Node's environment teardown) whenever the process received SIGTERM — every container recreate on deploy. `server.ts` now closes the HTTP server and the database explicitly on `SIGTERM`/`SIGINT` before exiting, so shutdown is clean instead of racing native cleanup. Found live: the previous 0.1.3.1 deploy crash-looped `cast-api` during its own container recreate, which in turn kept `cast-web` from starting at all (`depends_on: service_healthy`) — the site was briefly fully down until the retry below and this fix.
- [Infra] `deploy.sh` / `cast-autoupdate.sh` retry `docker compose up -d` once after a short wait if it fails — covers the transient window (above) where the outgoing container is still unhealthy and `web`'s health-gated dependency aborts the first attempt.

## v0.1.3.1 — build 2608002 — 2026-08-07T21:39:49Z

### Changed
- [Infra] `deploy.sh` / `cast-autoupdate.sh` build `cast-api` and `cast-web` **sequentially** instead of Docker Compose's default parallel build — the deploy host is 2 vCPU/4GB, and building both images at once had already caused one build to fail from memory pressure.
- [Infra] Both Dockerfiles cache pnpm's content-addressable store across builds (`--mount=type=cache`) — a lockfile change now only re-downloads the diff instead of the whole dependency tree.
- [Docs] `versioning.md` / `changelog-and-releases.md`: a trailing `.0` CORRECTION segment is now dropped **everywhere** a version is shown to a human (changelog, Release Notes, commit subjects, in-app displays), not just in "casual display" as before. Retro-fixed the four existing changelog headers to match.

## v0.1.3 — build 2608001 — 2026-08-07T21:12:25Z

### Fixed
- [Infra] **Installer no longer loops on the UAC prompt.** The admin check moved from `net session` to `fltmc`: `net session` depends on the Server service, which many hardened/managed environments disable — with it off the check fails even *after* elevation, so the script concluded it was still unelevated and relaunched itself repeatedly. A one-shot `%1` guard makes a second elevation structurally impossible: only the original, argument-less launch can relaunch, and the relaunched copy carries `elevated` as `%1`.

### Changed
- [UX] Rail tagline breaks after "ConnectWise Augmentation" rather than running as one line in the narrow rail.
- [Design-System] Rail "CAST" title uses `text-box: trim-both cap alphabetic` (Chromium 133+) so `align-items: center` centres the **glyphs** instead of the line box — all-caps otherwise sits high. Degrades to the previous slightly-high rendering on older engines.

## v0.1.2 — build 2607003 — 2026-07-23T19:55:04Z

Extension `0.0.2 → 0.0.3`.

### Added
- [Extension] **Device identity via managed storage** — `Install-CAST.bat` stamps `%COMPUTERNAME%` into the extension's 3rdparty policy, `managed-schema.json` declares it, and the service worker reads `deviceName`. `deviceId` stays a per-profile UUID, so multiple browsers on one machine remain distinct rows sharing one device name.
- [Frontend] Deployment tab: per-row prune of a stale device/browser **record** (auth-gated `DELETE /checkins/:id`), behind a confirm modal that makes clear it does not uninstall the extension.
- [Database] `device_name` column on `checkins` (guarded migration); the check-in API accepts and returns it.
- [Extension] Popup: manual refresh control beside Last sync.

### Changed
- [Extension] Browser reported as a friendly label ("Microsoft Edge v150… (64-bit)") via `userAgentData`, not the raw UA string.
- [Extension] Popup "Department" → **"View Applied"** (named views); the selection persists per browser via `chrome.storage.local`.
- [UX] Deployment tab shows device name before browser, and drops the duplicated per-row sync time (the Latest sync column already carries it).
- [Design-System] Rail: "CAST" title sized to 85% of the icon height and vertically centred; product name moved from the footer to under the logo; footer shows only version + build; version display drops a trailing `.0`.

## v0.1.1 — build 2607002 — 2026-07-23T19:26:18Z

### Added
- [Frontend] **Tab state backed by `?tab=`** (`useTabParam`) on the Browser Extension and Vessel Tracking pages, so a refresh or a shared link keeps the same tab instead of snapping back to the first. Legacy vessel routes redirect to the matching tab.

### Changed
- [Backend] Fleet filters CW members to `licenseClass='F'` (real member users), excluding the 15 API/integration accounts (CPQ, RMM, BrightGauge, `app_CAST`, …). Verified live.
- [UX] Extension tabs renamed: "Fleet" → **"Deployment"** (the per-member catalog) and "Deployment" → **"Install"** (the installer); components renamed to match.
- [UX] Devices column empty state "Not installed" → "Not registered".
- [UX] User column sorted alphabetically.

## v0.1.0 — build 2607001 — 2026-07-23T18:33:45Z

First stamped build — build-number discipline starts here. Bundles the pre-release scaffolding plus this build's work, cut for the first real extension install.

### Added
- [Frontend] **Download-first public landing** (`/download`, Chrome & Edge) with a one-click self-elevating installer; **Configuration sign-in** moved to `/login`.
- [Extension] **MV3 runtime** (role/department rule engine, config-poll + check-in phone-home, popup) packed into a **self-hosted, self-updating signed `cast.crx`**; repack via `scripts/pack-extension.sh`.
- [Frontend] **Fleet** — per-active-member check-in catalog (real CW users only, not API members) with each member's device/browser pairs and an All / Current / Needs-attention deployment filter over an adjustable freshness threshold.
- [Infra] **Build-number system** — `version.json` + `scripts/bump-build.sh` (`YYMM###`, resets monthly), baked into the SPA and shown in the rail footer.
- [UX] **ux-designer review agent** (`.claude/agents/ux-designer.md`) — all UI reviewed for visual quality + design-system compliance before deploy.

### Changed
- [UX] Nav consolidated to two Workspace sections — **Browser Extension** (renamed from "CAST Extension") and **Vessel Tracking** (Vessel Location / Vessel Identity / Tracking Config / Geo Alerts as tabs).
- [Design-System] New **CAST trident** branding across the app favicon, rail, and extension icons (16/32/48/128). Extension `0.0.1 → 0.0.2`.

### Added (pre-release scaffolding)
- [Frontend] **Design-system foundation** (ADR-0007): `styles/tokens.css` (Logistics Coordinator's Triton palette, CAST-named semantic tokens, light + dark-ready), `base.css`, `components.css`, and a `src/ui/` React primitive library (Button, Card, Badge, StatusDot, Field, Table, Modal, Toast, Tabs, Gauge, PageHeader, EmptyState, Banner, Spinner, Icons). Charcoal-rail app shell. Scaffold pages re-tokenized. Governance rules written first: `knowledge/architecture/design-system.md`.
- [Frontend] Four screens built purely by composition on the system: **Vessel Identity** reconciliation (`INIT-0014`), **Vessel Tracking Config** (`INIT-0015`), **Integrations**/credentials (`INIT-0013`), **System Health** (`INIT-0016`).
- [Backend] Live **ManageCwClient** (ConnectWise REST, LC pattern) — reads verified against `tritontech` (235 tracked vessels, statuses, boards); an encrypted-at-rest secret store (AES-256-GCM, `INIT-0013`); routes `/api/health/full`, `/api/tracking/*`, `/api/integrations/*`.
- [Infra] Deploy artifacts (mirroring LC): `docker-compose.yml` (api + web + TLS), TLS-terminating `components/web/nginx.conf`, and `scripts/` — self-signed→acme-dns TLS setup, manual deploy, and a **GA-only unattended auto-update** systemd timer. Recorded in `knowledge/architecture/cast-web-app-deployment.md`.
- [Security] All **ConnectWise writes hard-gated** behind `CW_WRITES_ENABLED` (default off) — verified refused at runtime. CW connection live-verified; real custom-field captions (`Vessel IMO` / `Vessel MMSI`) and the integration pattern recorded (`knowledge/architecture/connectwise-api-integration.md`).
- [Docs] Governance & knowledge canon scaffolded: router `CLAUDE.md`, `knowledge/` (conventions, templates), `Initiatives-Open.md` / `Initiatives-Complete.md`, and this changelog.
- [Docs] Design/decision record for the **CAST browser extension** incorporated as `knowledge/architecture/browser-extension.md`, with its core architectural boundary recorded as `knowledge/decisions/0002-extension-never-touches-cw-credentials.md`.
- [Docs] Recorded a second, centralized-configuration component (CAST web app, `INIT-0008`) as part of the larger CAST web app, and the extension's repo/folder topology (`components/browser-extension/`, no submodule) as `knowledge/decisions/0003-extension-repo-topology.md`.
- [Docs] Reversed course on repo topology: CAST is a single private monorepo (`knowledge/decisions/0004-monorepo-with-artifacts-only-public-surface.md`, supersedes 0003). The extension's public surface is CI-generated build artifacts only, published to an unlisted host — never source, never a separate repo.
- [Docs] Committed Chrome + Edge as the extension's browser scope; deferred Firefox (`INIT-0010`) and Shift (`INIT-0011`, opportunistic only). Recorded the multi-browser deployment mechanics in `knowledge/architecture/browser-extension.md` §8.5.
- [Docs] New architecture record `knowledge/architecture/extension-telemetry-and-identity.md`: the update-staleness banner design, the `chrome.storage.managed` device/OS-user identity mechanism (explicitly excluding `chrome.identity.getProfileUserInfo()`), and the check-in catalog (`INIT-0009`).
- [Docs] Renamed the project from "Triton CW Enhancer" to **CAST** (ConnectWise Augmentation Suite for Triton) across the canon.
- [Docs] Folded the browser extension's separate name ("Triton View Manager for ConnectWise") into the CAST brand — extension and web app now share one name, distinguished only by context.
- [Docs] Recorded the CAST web app's hosting target: internal Linux VM, Docker, `cast.tritontechnical.com` (`INIT-0008`).
- [Frontend] Scaffolded the **CAST web app frontend** (`components/web`, Vite + React SPA): login (AD + local fallback) over the API, route protection, app shell, and the `CAST Extension` (tabbed) + `Vessel Location Updating` pages (bodies are placeholders against the mockup; the vessel page reads live from `GET /api/vessels`). Typechecks + builds clean.
- [Backend] Scaffolded the **CAST web app backend** (`components/api`, Express + TypeScript via tsx): JWT-httpOnly-cookie auth (AD LDAPS bind + CAST-Users group gate, local bcrypt fallback), `requireAuth` middleware, extension-config routes (validated against `@cast/config-schema`), vessel routes, and a `node-cron` vessel-sync job (`INIT-0012`). Runtime-verified — health/config open, all protected routes 401 without a session.
- [Backend] Established the monorepo as **pnpm + turbo TypeScript workspaces** (mirroring Limnode) with a shared `@cast/config-schema` package (`packages/config-schema/`) — the config contract shared by the web app (author) and extension (consumer). Deploy via `docker-compose.yml` (nginx serving the SPA + proxying `/api`, SOC-style).
- [Docs] Stack decision **corrected**: `knowledge/decisions/0006-web-app-stack-vite-react-express.md` (Vite React SPA + Express API, matching the org's SOC/Limnode conventions) supersedes `0005` (TypeScript monorepo + SvelteKit) — the framework had been chosen without checking existing-project conventions.
- [Infra] Provisioned the web app's deploy host `trt-cast-01` (Ubuntu 24.04, 2 vCPU/4 GB, Docker 29.6.2 + Compose, Tailscale-managed) and recorded it as `knowledge/architecture/cast-web-app-vm-provisioning.md`, including the open VLAN-egress blocker and the parked static-IP config.
- [UX] First interactive mockup of the **CAST web app**: AD-gated login with a local-account fallback, a "CAST Extension" page (tabs: Role Rules, Expected Pods, Fleet, Deployment), and a new **Vessel Location Updating** page. Recorded as `knowledge/architecture/cast-web-app-mockup.md`.
- [Docs] Captured `INIT-0012` — Vessel Location Updating: look up each vessel-client's IMO number against a marine-traffic data source and write its current position into a designated CW location's address field on a schedule. Flagged as this repo's first concrete instance of `INIT-0002`.
- [Docs] Recorded the CAST web app's authentication direction in `INIT-0008`: primary login against internal AD gated by a security group, with a local-account fallback for AD outages; integration mechanism (LDAPS vs. Windows Integrated Auth vs. Entra ID/ADFS) left open.
- [Docs] Added canonical terms to `knowledge/conventions/naming-lexicon.md`: CAST Users (AD group), Local Account, Vessel, IMO Number, Navigational Status, Target Location, Vessel Location Updating.

- [Integrations] Selected **aisstream.io** as the AIS data source for Vessel Location Updating (`INIT-0012`) — a free, legitimate WebSocket API that resolves the prior MarineTraffic-ToS blocker. API key stored server-side only (`components/api/.env`, `CAST_AISSTREAM_API_KEY`; wired via `config.ts`). Architecture + design consequences (push-stream not lookup, IMO↔MMSI mapping, reverse-geocoding, nav-status mapping) recorded as `knowledge/architecture/vessel-location-updating-aisstream.md`.
- [Docs] Captured `INIT-0013` — in-app secure secret management (encrypted-at-rest API-key entry/update in the web app), to eventually replace hand-editing `.env`.

- [Backend] Scaffolded the **Vessel Identity reconciliation** backend (`INIT-0014`, `components/api/`): pure IMO check-digit + MMSI validation, app-assisted free-lookup deep-links (IMO→MMSI, ToS-safe), a swappable `CwClient` interface with an in-memory stub (real `ManageCwClient` pending CW keys — modelled on LogisticsCoordinator's live integration), and `GET`/`POST` routes at `/api/vessel-identity` (audit + validated write-back). CAST's first ConnectWise *write* path. Typecheck + smoke verified.

- [Infra] **CAST deployed to `trt-cast-01`** — live at `https://cast.tritontechnical.com` (Docker: nginx-TLS + api), with a real **auto-renewing Let's Encrypt cert** (acme-dns DNS-01, mirroring LC) and the **GA-only unattended auto-update** systemd timer enabled. api healthy, `better-sqlite3` store built in-image, ConnectWise writes gated off.
- [Changed] A vessel is now **any CW company with Market containing "Yacht"** (295 companies, incl. those missing IMO/MMSI), not identifier-presence — configurable via `CW_VESSEL_MARKET`. Secret/settings store moved to **better-sqlite3** (encrypted secret values at rest).

### Changed
- [Infra] `trt-cast-01` moved to its **permanent static IP `10.20.30.231/24`** (gw `10.20.30.1`, DNS `10.20.30.208`/`.209`, search `triton.local`) after the network team fixed the VLAN-egress blocker — egress + `triton.local` DC resolution verified live. Cutover done remotely over Tailscale with a self-healing 5-minute auto-revert backstop. `knowledge/architecture/cast-web-app-vm-provisioning.md` updated (§2 static, §4 blocker resolved, §6 items checked). *(2026-07-22T23:20Z)*

> The first software build will be tagged **`v0.1.0.0`** when application code lands — declared by the user.
