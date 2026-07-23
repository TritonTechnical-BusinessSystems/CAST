# Changelog

All notable changes to CAST. Format: `knowledge/conventions/changelog-and-releases.md`.

Product version: `MAJOR.MINOR.PATCH.CORRECTION` (MAJOR `0` until `1.0` is declared).
Build stamp: `YYMM###` (year, month, build # within that month). Each entry carries an ISO-8601 UTC timestamp.

Change types: **Added · Changed · Fixed · Removed · Deprecated · Security**.
Category tags: `UX · Frontend · Backend · Database · API · Integrations · Design-System · Docs · Security · Performance · Infra`.

---

## Unreleased

### Added
- [Frontend] **Design-system foundation** (ADR-0007): `styles/tokens.css` (Logistics Coordinator's Triton palette, CAST-named semantic tokens, light + dark-ready), `base.css`, `components.css`, and a `src/ui/` React primitive library (Button, Card, Badge, StatusDot, Field, Table, Modal, Toast, Tabs, Gauge, PageHeader, EmptyState, Banner, Spinner, Icons). Charcoal-rail app shell. Scaffold pages re-tokenized. Governance rules written first: `knowledge/architecture/design-system.md`.
- [Frontend] Four screens built purely by composition on the system: **Vessel Identity** reconciliation (`INIT-0014`), **Vessel Tracking Config** (`INIT-0015`), **Integrations**/credentials (`INIT-0013`), **System Health** (`INIT-0016`).
- [Backend] Live **ManageCwClient** (ConnectWise REST, LC pattern) — reads verified against `tritontech` (235 tracked vessels, statuses, boards); an encrypted-at-rest secret store (AES-256-GCM, `INIT-0013`); routes `/api/health/full`, `/api/tracking/*`, `/api/integrations/*`.
- [Infra] Deploy artifacts (mirroring LC): `docker-compose.yml` (api + web + TLS), TLS-terminating `components/web/nginx.conf`, and `scripts/` — self-signed→acme-dns TLS setup, manual deploy, and a **GA-only unattended auto-update** systemd timer. Recorded in `knowledge/architecture/cast-web-app-deployment.md`.
- [Security] All **ConnectWise writes hard-gated** behind `CW_WRITES_ENABLED` (default off) — verified refused at runtime. CW connection live-verified; real custom-field captions (`Vessel IMO` / `Vessel MMSI`) and the integration pattern recorded (`knowledge/architecture/connectwise-api-integration.md`).
- [Docs] Governance & knowledge canon scaffolded: router `CLAUDE.md`, `knowledge/` (conventions, templates), `Initiatives-Open.md` / `Initiatives-Complete.md`, and this changelog.
- [Docs] Design/decision record for the **CAST browser extension** incorporated as `knowledge/architecture/browser-extension-view-manager.md`, with its core architectural boundary recorded as `knowledge/decisions/0002-extension-never-touches-cw-credentials.md`.
- [Docs] Recorded a second, centralized-configuration component (CAST web app, `INIT-0008`) as part of the larger CAST web app, and the extension's repo/folder topology (`components/view-manager-extension/`, no submodule) as `knowledge/decisions/0003-extension-repo-topology.md`.
- [Docs] Reversed course on repo topology: CAST is a single private monorepo (`knowledge/decisions/0004-monorepo-with-artifacts-only-public-surface.md`, supersedes 0003). The extension's public surface is CI-generated build artifacts only, published to an unlisted host — never source, never a separate repo.
- [Docs] Committed Chrome + Edge as the extension's browser scope; deferred Firefox (`INIT-0010`) and Shift (`INIT-0011`, opportunistic only). Recorded the multi-browser deployment mechanics in `knowledge/architecture/browser-extension-view-manager.md` §8.5.
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
