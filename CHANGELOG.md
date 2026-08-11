# Changelog

All notable changes to CAST. Format: `knowledge/conventions/changelog-and-releases.md`.

Product version: `MAJOR.MINOR.PATCH.CORRECTION` (MAJOR `0` until `1.0` is declared).
Build stamp: `YYMM###` (year, month, build # within that month). Each entry carries an ISO-8601 UTC timestamp.

Change types: **Added · Changed · Fixed · Removed · Deprecated · Security**.
Category tags: `UX · Frontend · Backend · Database · API · Integrations · Design-System · Docs · Security · Performance · Infra`.

---

## v0.8.0 — build 2608016 — 2026-08-11T05:19:18Z

### Added
- [Backend] **The AIS monitor is live end to end** (`INIT-0012`) — a long-lived WebSocket listener, a latest-position cache, and a scheduled writer that publishes each tracked vessel's current status back into ConnectWise. `components/api/src/vessels/aisListener.ts`: two connections matching the Tier 1/2 design — Tier 1 dedicated and always-on (≤50 MMSIs), Tier 2 rotating through its pool in batches of ≤50 on its own 60s timer. Native Node `WebSocket` (no new dependency), exponential backoff + jitter on disconnect, uncapped retries. `jobs/tierRefresh.ts` pushes its freshly-computed split into the listener the moment it recomputes (every 5 minutes by default) — the listener never polls on its own — and also applies whatever split was last persisted immediately at boot, so a restart doesn't sit idle for a full cycle.
- [Database] New `vessel_positions` table (mmsi PK: lat, lon, sog, cog, nav-status code, last-seen, plus voyage columns for destination/ETA from `ShipStaticData`) in the same shared `cast.db` — confirmed no separate database is needed for latest-position-only data (history/time-series remains a distinct, not-yet-needed concern). `GET /api/vessels/positions` for live inspection of what's actually being received.
- [Backend] **ConnectWise write-back**: each tracked vessel's Vessel Site gets its **name** updated to a friendly status + place/destination (e.g. "Vessel docked in La Ciotat, France" / "Vessel underway to Barcelona, Spain (ETA: 11 Aug 21:15 UTC)") and its **addressLine1** updated to raw decimal coordinates for direct Google Maps lookup. New `CwClient.updateVesselSite()`; pure formatter in `vessels/siteWriter.ts`; nav-status codes mapped to friendly buckets in `vessels/navStatus.ts` (docked/anchored/underway/aground/unknown, stale-signal threshold 6h); nearest-port name resolved via a bundled, filtered UN/LOCODE dataset (`vessels/nearestPort.ts` + `ports.csv`, 16,657 ports, haversine nearest-neighbor, 50nm "at sea" cutoff) — chosen over NGA World Port Index because the fleet is predominantly superyachts, which mostly anchor at small marinas and coastal towns NGA's commercial-port-biased list would miss. Writes are diffed against the last-written value per site (`tracking.lastSiteWrite`) so an unchanged status doesn't re-write every cycle; stale/no-data vessels are left untouched rather than overwritten. `prioritizeVessels`'s `lastKnownByMmsi` (present since the priority engine was first built but never wired) is now fed from the real position cache, so the "underway" tiebreaker is live.
- [Backend] Two backpressure/health gauges, per the user's direct ask about aisstream's documented "keep up or get dropped" behavior: per-connection message-processing time (parse + upsert, rolling last-minute avg/max) and a process-wide event-loop-lag histogram (`health/eventLoopLag.ts`, Node's `perf_hooks.monitorEventLoopDelay`). Surfaced on System Health as AIS Tier 1 / Tier 2 probe cards (connection state, MMSI count, msg/min, reconnect count) and a "Process backpressure" card.

### Removed
- [Backend] `jobs/vesselSync.ts` — the pre-aisstream `node-cron` stub (referenced superseded concepts: a marine-traffic API, "Target Location") — deleted entirely along with the now-unused `node-cron` dependency, superseded by `aisListener.ts` + the tier-refresh cycle's write step.

### Fixed
- [Backend] `GET /api/tracking/config`, `POST /api/tracking/config`, and `POST /api/tracking/preview` now merge the stored/posted rule over `DEFAULT_RULE` instead of trusting it as complete — a rule persisted before a future schema addition would otherwise crash every reader that assumes the full shape (the exact class of bug fixed for `projectStatuses`/`autoCreateVesselSite` in v0.6.1).
- [Backend] `listServiceBoards()`'s Admin-department exclusion now correctly covers all three Admin boards ("Admin", "Ψ Discover Better", "Triton Management") — an earlier pass had only accounted for two.

### Docs
- [Docs] `knowledge/architecture/vessel-location-updating-aisstream.md` §4 rewritten — nearly every item on the "still open" list from the original design is now resolved and documented; the one genuinely open item (unverified `ShipStaticData` field shape — live-testing twice returned zero messages on a global bounding box, cause unknown) is called out explicitly rather than assumed correct.



### Added
- [Frontend] Tracking Config's Preview card now shows the **full ranked priority list** for both tiers instead of an 8-item sample + "…and N more" — every tracked client, numbered by its overall rank (Tier 1 numbered 1..N, Tier 2 continuing from Tier 1's count + 1), laid out in a 5-column flowing list (`.rank-columns`, responsive fallback to 2 columns at 768px and 1 at 480px). Backend `POST /api/tracking/preview` returns the full ordered vessel list per tier instead of a capped sample (`toList()` replaces `sample()` in `routes/tracking.ts`).

### Changed
- [UX] Vessel Tracking's tab order changed to **Tracking Config, Vessel Identity, Vessel Location, Geo Alerts** (previously Vessel Location first) — Tracking Config is now the default landing tab.

## v0.6.1 — build 2608014 — 2026-08-11T04:24:41Z

### Fixed
- [Backend] **Tracking Config blanked to an empty page immediately after the v0.6.0 deploy**, and the scheduled tier-refresh job crashed every cycle (`docker logs cast-api`: `TypeError: Cannot read properties of undefined (reading 'length')` in `computeSplit`). Root cause: the `tracking.rule` setting persisted in production predates the `projectStatuses`/`autoCreateVesselSite` fields added in v0.6.0, so the stored object was missing them entirely — every reader assumed the full `Rule` shape (`rule.projectStatuses.length`, `rule.projectStatuses.includes(...)` in `TrackingConfig.tsx`'s render, which threw and unmounted the whole page). Fixed by merging the stored/posted value over `DEFAULT_RULE` everywhere a `Rule` is read from settings or a request body — new `getStoredRule()` in `routes/tracking.ts` (used by `GET /api/tracking/config` and `jobs/tierRefresh.ts`, which also drops its own now-redundant duplicate `Rule`/`DEFAULT_RULE`), and `POST /api/tracking/config` / `POST /api/tracking/preview` merge their request bodies the same way before use or persistence. Verified against the stub client with a simulated pre-migration rule object.

## v0.6.0 — build 2608013 — 2026-08-11T03:35:10Z

### Changed
- [Backend] **AIS monitor ranking rewritten to strict priority groups** (`INIT-0012` §3.6), replacing the additive pinned/ticket/underway score from `v0.4.0`. Every **Trackable Vessel** (Tracked Vessel + valid MMSI + resolved Vessel Site) with an **open Project in a selected status** unconditionally outranks every one with only an **open ticket on a selected board** — no exceptions — and within a group, most-recent activity wins (`_info.lastUpdated`, confirmed present on both CW tickets and real CW Projects). A Trackable Vessel with **neither** gets no AIS coverage at all, not even Tier 2. `components/api/src/vessels/priority.ts` rewritten; `CwClient.listOpenProjectActivity()`/`listOpenTicketActivity()` (both `Map<companyId, ISO timestamp>`) added alongside `listProjectStatuses()` and a matching "Open projects in status" card on Tracking Config. Verified live: 294 tracked candidates → 201 with a valid MMSI → 10 with an open Project → 99 with open ticket work.
- [Backend] **Scheduled Tier 1/2 refresh** — `components/api/src/jobs/tierRefresh.ts`, a self-rescheduling `setTimeout` (not `node-cron`, so the interval is runtime-adjustable without a restart) recomputes the split every 5 minutes by default and persists it (`tracking.currentSplit`) for the not-yet-built AIS listener to consume. Interval is configurable via `GET/PUT /api/tracking/refresh-interval` (`tracking.write`-gated), env `CAST_TRACKING_REFRESH_MINUTES` is only the boot-time seed.
- [Backend] **Vessel Site resolution reworked to local-first + self-healing**, replacing `v0.5.0`'s manual bulk "Resolve vessel sites" sweep. The tier engine and live preview now read `tracking.siteMap` purely locally — zero ConnectWise calls, ever. A new `reconcileVesselSites()`, called only from the scheduled tier-refresh job (never from the interactive preview), CW-queries just the still-unresolved delta each cycle. New opt-in rule setting **"Automatically create a Vessel site for any client with an MMSI and Yacht market type"** (`Rule.autoCreateVesselSite`, off by default): when on, a client with no active "Vessel…" site gets one created via `CwClient.createVesselSite()` (`isCwWritesEnabled()`-gated) instead of staying excluded indefinitely. Minimal creation payload (`name: "Vessel"`, `addressLine1: "(Vessel's current location unknown)"`) verified against a real existing site record's shape.
- [Removed] **Manual override layer removed entirely** — first "pin" (an arbitrary per-person promotion isn't a fair, formula-driven ranking), then "exclude" too, same principle: to stop tracking a vessel, remove its MMSI in ConnectWise (already a hard requirement) instead of a CAST-side toggle. `GET/PUT /api/tracking/pins`/`/excludes` and the manual "Resolve vessel sites" button/route are all gone. Every Tier 1/2 outcome is now a pure formula result over live CW data — no settings-backed override of any kind remains.
- [Frontend] Tracking Config's Preview card drops the manual "Resolve vessel sites" button/summary and the `excludedManually` count; copy across the Tier-refresh and Preview cards updated to describe the new automatic behavior. `ux-designer`-reviewed (two passes): split the criteria cards into two paired grids (`.card-grid-pair`), fixed the refresh-interval number input's width (`.w-num`) and missing accessible name, matched its Save button height to the input, and retitled "Open work on board" to "Open tickets on board" for copy consistency. Second pass: fixed a shared `.checkbox` primitive bug where a long label shrank the checkbox itself instead of wrapping around it (missing `flex: none`) and mis-aligned it against multi-line labels; moved the new auto-create checkbox out of the "Identifiers" filter card into "Tier refresh" (where its cadence is explained) and added a visible warning when ConnectWise writes are disabled instead of the option silently doing nothing; renamed the interval "Save" button to "Save interval" to disambiguate it from the page's main "Save rule" action; made "Vessel Site" capitalization consistent throughout the page.
- [Security] `reconcileVesselSites()`'s auto-create path now independently requires a valid MMSI regardless of whether "Require MMSI" is checked in the saved rule — closes a gap where unchecking that filter (e.g. to audit vessels missing an MMSI) could have let auto-create create ConnectWise sites for vessels the option's own label doesn't cover. Found in `ux-designer` review, not reported.
- [Backend] Company Status, Open-projects-status, and Open-tickets-board option lists (`GET /api/tracking/options`) are now sorted alphabetically (`listCompanyStatuses`/`listServiceBoards`/`listProjectStatuses` in `manageClient.ts`) instead of ConnectWise's native id order.
- [Backend] `listServiceBoards()` now excludes any board assigned to the "Admin" ConnectWise department (verified live: "Admin", "Ψ Discover Better", and "Triton Management") — internal admin work on those boards shouldn't be selectable as a vessel-tracking priority signal. Same exclusion extended to the Project-activity signal (`queryOpenProjectActivity`, via each CW Project's own `board` field, `board/name not in (...)`) — Admin-board projects don't feed Tier 1 priority either. `listServiceBoards()`, `listCompanyStatuses()`, and `listProjectStatuses()` also now all exclude inactive records/boards (CW marks retired ones `inactiveFlag=true` rather than deleting them — verified live: two retired example boards were still showing up as selectable).

### Docs
- [Docs] `naming-lexicon.md`, `Initiatives-Open.md` (`INIT-0012`), and the architecture note (`vessel-location-updating-aisstream.md` §3.6/§4) all rewritten to match: strict priority groups, no manual override of any kind, and the local-first/self-healing Vessel Site design. The Vessel Site's write-target field is now believed confirmed (`addressLine1`, from inspecting a real existing site record) rather than an open guess.

## v0.5.0 — build 2608012 — 2026-08-11T02:56:55Z

### Added
- [Backend] **Vessel Site resolution** (`INIT-0012`) — decides and remembers *which ConnectWise record* each tracked vessel's AIS status/location gets written to: the company's CW site whose name starts with "Vessel". `components/api/src/vessels/siteResolution.ts` (`resolveVesselSite`, pure state machine, smoke-tested against 8 scenarios): resolved once, then **cached by site ID** so a later rename never breaks the mapping; only the site being **deleted or inactivated** clears the cache, which then re-detects the next time an active "Vessel…" site exists for that company. A tracked vessel with no resolvable Vessel Site is **excluded from AIS tracking entirely** — same hard-requirement tier as a missing MMSI.
- [Integrations] `CwClient.getCompanySites(companyId)` — `GET /company/companies/{id}/sites`, verified live against real CW.
- [Backend] `POST /api/tracking/sites/resolve` (`tracking.write`-gated, 8-way concurrent) — walks the current tracked set, resolves each company's Vessel Site, and persists the map (`tracking.siteMap`). Explicit/manual for now, not scheduled — matches where the rest of the AIS monitor stands.
- [Frontend] "Resolve vessel sites" button on Tracking Config, with a result summary (kept/resolved/cleared/still-none, and a flag for any company with more than one candidate site). The Preview card's exclusion breakdown now includes vessels matched but not yet resolvable to a Vessel Site.

### Changed
- [Docs] Corrected the CW write-target design: earlier notes guessed at two custom fields on the company; the user clarified the record is a specific **CW site** per company (name starts with "Vessel"), with rename-safe ID caching. Updated `INIT-0012`, the architecture doc, and added **Vessel Site** to the naming lexicon (cross-referenced from the already-superseded "Target Location" entry). The exact fields to write *on* that site are still open.

## v0.4.0 — build 2608011 — 2026-08-11T02:47:43Z

### Added
- [Backend] **AIS monitor priority/tier-split engine** (`INIT-0012` §3.6) — the first real piece of the AIS monitor: given aisstream's ≤50-vessel subscription cap, decides which vessels get **Tier 1** (real-time, dedicated subscription) vs **Tier 2** (rotated, best-effort). `components/api/src/vessels/priority.ts` (`prioritizeVessels`, pure/unit-tested): pinned > open-ticket > neither, "underway" as a same-tier tiebreaker only, hard-excludes anything without a valid MMSI, deterministic tie-break (avoids resubscribe churn between runs when nothing changed).
- [Integrations] `CwClient.listOpenTicketCompanyIds(boardNames)` — the "open work on board" query `INIT-0015` had flagged but never built. Verified live against real CW: this instance tracks project-related work via service tickets on project-named boards (e.g. "🏗️ Projects"), not CW's separate Project module.
- [Backend] Manual pin/exclude override layer — `GET/PUT /api/tracking/pins`, `tracking.write`-gated. Pinned always wins Tier 1 (subject to the MMSI requirement); excluded is dropped from AIS tracking regardless of the rule. API-only for now, no dedicated UI yet.
- [Frontend] `POST /api/tracking/preview` and `TrackingConfig.tsx` now show the real Tier 1 / Tier 2 split (count + sample each) instead of a flat match count, plus counts for matched-but-not-trackable (no valid MMSI) and manually-excluded vessels.

### Changed
- [Backend] **Resolved a real design ambiguity between two docs:** whether "open work on board" gates *whether* a vessel is tracked at all, or only its *priority* once tracked. Confirmed with the user: **priority only** — Tracked-Vessel membership is Company Status + Identifiers alone; a vessel between engagements still gets baseline Tier-2 coverage instead of dropping out of tracking entirely. Reworded the Tracking Config banner and board-criterion card copy to match; corrected `INIT-0012`/`INIT-0015` and the architecture doc, which had disagreed.
- [Security] `POST /api/tracking/config` was gated on `requireAuth` only, not `tracking.write` as the permission model intends — any authenticated viewer could edit the tracking rule. Fixed to `requirePermission("tracking.write")`, matching `PUT /api/tracking/pins` and the geo-alerts route's existing pattern.
- [Design-System] **Fixed a real bug in the shared `Banner` primitive**, found by `ux-designer` mid-review: `.banner`'s `display: flex` treated every top-level child node as its own flex column, so a message with multiple `<strong>` runs split into unreadable disconnected columns (clipped entirely off the right edge on mobile). This was already latent in `GeoAlerts.tsx` and `Vessel.tsx` — just masked by shorter copy. Fixed once in the primitive (`Banner.tsx` wraps children in one flex item) so every consumer is covered, not just the page that surfaced it.
- [Design-System] `.card-grid` now uses `align-items: start` — content-uniform cards next to a taller card were being stretched to match it, leaving large empty panels (visible for the first time on Tracking Config's three-card layout; audited the other four consumers, all hold uniform-height content already).
- [Docs] `naming-lexicon.md`'s "Target Location" entry was fully superseded (described overwriting a site's street address; the real design writes friendly status + place name) and never corrected until now — marked superseded, added **Tracked Vessel**, **Monitoring Tier**, **Pinned/Excluded Vessel** as canonical terms.

## v0.3.0.1 — build 2608010 — 2026-08-11T02:24:01Z

### Removed
- [Frontend] **Vessel Identity Quick Entry** (`/vessel-identity-quick-entry`) — the IMO/MMSI backlog is clear, so the temporary tool from `v0.3.0` is torn down exactly as planned: the page, its route, and the link on the Vessel Identity tab. No backend to unwind (it only ever called the existing `/api/vessel-identity` routes) — the `vessel.reconcile` permission fix from the same release stays.

## v0.3.0 — build 2608009 — 2026-08-09T17:00:11Z

### Added
- [Frontend] **Vessel Identity Quick Entry** (`/vessel-identity-quick-entry`) — a **temporary** tool for powering through the IMO/MMSI backlog: one table, inline-editable fields per row (no modal), per-row Save, and a "Save all" that walks unsaved rows sequentially. Linked from the existing Vessel Identity tab. Built entirely on the existing `GET/POST /api/vessel-identity` routes (`INIT-0014`) — no new backend. Explicitly marked for deletion once the backlog clears (see the file's own header comment).

### Security
- [Backend] `POST /api/vessel-identity/:id` was gated on `requireAuth` only, not the `vessel.reconcile` permission it was supposed to require — any authenticated viewer could write ConnectWise identifiers, relying solely on the `CW_WRITES_ENABLED` env gate rather than the permission system. Fixed to `requirePermission("vessel.reconcile")` while building the page above. Found reading the route, not reported.

### Fixed
- [Frontend] Quick Entry prefilled invalid/missing IMO or MMSI values with their existing (broken) content — every untouched invalid field rode along on Save and failed server-side validation, so "Save all" 400'd on nearly every row of exactly the backlog it exists to clear. Now only prefills a field when it's already valid; invalid/missing fields start blank with a badge explaining why (existing value + reason, or "Missing"). Also restored the lookup links (Balticshipping/VesselFinder/web search) that the sibling Vessel Identity tab has and this page initially omitted, and disabled Save/Save-all for users lacking `vessel.reconcile`, not just when CW writes are off. Caught by `ux-designer` before deploy, confirmed against the live API (`POST` with a stale IMO 400'd; verified the fix removes it from the payload).

## v0.2.1 — build 2608008 — 2026-08-07T23:06:02Z

### Fixed
- [Security] **API could crash entirely on a bad login attempt.** `config.ts` used `??` for `CAST_JWT_SECRET`, which doesn't fall back on an empty string (only null/undefined) — a blank value in `.env` reached `jwt.sign()`, which throws synchronously inside an async route handler; Express 4 doesn't catch that, so it became an unhandled rejection and took down the whole process, not just the request. Fixed the fallback (`||`) and wrapped the login route in try/catch, matching this codebase's existing per-route error-handling convention. Found live by `ux-designer` mid-review, not something a user hit in production (production's `.env` never had this value blank — the startup fail-fast check would have refused to boot if it had).
- [Backend] **System Health's "Application" card showed a different version than the rail footer and `version.json`.** `CAST_VERSION`/`CAST_BUILD` env vars were read but never actually set anywhere (not in `docker-compose.yml`, not in either Dockerfile) — silently always reported stale/placeholder values. Now reads `version.json` directly (same approach `vite.config.ts` already uses for the frontend); added the missing `COPY version.json` to `components/api/Dockerfile`'s final stage.
- [Frontend/Design-System] Second `ux-designer` live-browser pass (using its new permanent browser access from `v0.2.0`) found real desktop layout bugs my first source-only attempt missed: the Docker Containers table's stacked cells didn't actually stack outside the mobile breakpoint, the table squeezed columns unreadably instead of scrolling, the Integrations page clipped long values on mobile, and the confirm modal had no focus trap/restore (a keyboard user could tab past the ConnectWise-writes confirmation into page content behind it). All four fixed and re-verified live (measured DOM, real keypresses) before shipping — see `components/web/src/ui/Modal.tsx` and `components/web/src/styles/components.css` (`.td-stack`, `.table-dense`, `.kv`, `.panel` mobile rules).
- [UX] The auto-populated ConnectWise connection banner was louder and more permanent than the fact it stated (a full-width green banner duplicating the status dot 8px away); moved the detail to a quiet caption next to the dot, keeping the banner only for actual failures.

## v0.2.0 — build 2608007 — 2026-08-07T22:32:19Z

### Added
- [Frontend] **System Health: Docker container inventory.** A new "Docker Containers" card lists every container in the stack — name, purpose, image, live state/health, uptime, ports. `cast-api` never touches the raw Docker socket: it queries a new read-only `docker-proxy` service (`tecnativa/docker-socket-proxy`, `CONTAINERS` allow-listed only, never published to the host). Verified in isolation (proxy allows `GET /containers/json`, blocks `POST /containers/create` with 403) before wiring it in.
- [Backend] `GET /api/health/containers`.
- [Frontend] **ConnectWise writes are now toggleable in-app** (Integrations page, admin-only) — previously required editing `.env` and redeploying. Disabling is one click; enabling requires an extra confirm step (a modal explaining the consequence) since it's the riskier direction. A warning banner shows when writes are live.
- [Backend] `PUT /api/integrations/connectwise/writes`. `isCwWritesEnabled()`/`setCwWritesEnabled()` (`config.ts`) — the in-app value wins once set, with the env var (`CW_WRITES_ENABLED`) as the boot-time seed only; every write-check reads it live, no restart needed. First working precedent of the precedence rule `INIT-0013` needed.
- [UX] **`ux-designer` now drives a real, isolated browser** (Playwright, its own profile — never the shared FORGE desktop) as its default review step, not only when handed a screenshot. It starts a local dev instance, logs in as the break-glass account, navigates every changed route, and checks the mobile breakpoint. Source-only review is now the fallback for when no runnable instance exists. Closes half of `INIT-0022`'s tracked gap (the extension load-test against a real managed device is still open).

### Fixed
- [Backend] The real cause of the shutdown-crash investigated across 0.1.4.0–0.1.5: `better-sqlite3` v11.x on Node 24 ([WiseLibs/better-sqlite3#1376](https://github.com/WiseLibs/better-sqlite3/issues/1376)). Both Dockerfiles pinned to `node:22-slim`; zero crashes across 5 isolated start/stop cycles before deploying.
- [Infra] `cast-api` image **1.14GB → 511MB** (multi-stage build — the compiler toolchain no longer ships in production); `deploy.sh`/`cast-autoupdate.sh` build sequentially and retry `docker compose up -d` once, both fixing real failures hit live during this session's deploys.

### Docs
- `knowledge/architecture/cast-web-app-deployment.md` — topology updated for `docker-proxy`, corrected the bind-mount description, updated the deploy-script summary.
- `INIT-0016`, `INIT-0013`, `INIT-0022` updated to reflect the above.

## v0.1.5 — build 2608006 — 2026-08-07T21:59:29Z

### Fixed
- [Backend] **The real cause of the earlier shutdown crash (0.1.4.0) was `better-sqlite3` v11.x on Node 24, not shutdown timing.** The 0.1.4.0 fix (closing the db on SIGTERM) was real but insufficient — the crash trace showed it happening at *startup*, before the server even logged "listening", triggered by any `Statement` object's GC finalization racing Node 24's environment-cleanup-hook machinery ([WiseLibs/better-sqlite3#1376](https://github.com/WiseLibs/better-sqlite3/issues/1376), a documented, unresolved incompatibility). Both Dockerfiles pinned `node:24-slim` → `node:22-slim` — still satisfies the `>=22` engines floor, confirmed zero crashes across 5 start/stop cycles in isolation before deploying.



### Fixed
- [Infra] `cast-api`'s multi-stage split (0.1.4.1) left `pnpm` itself un-fetched in the final image — `corepack enable` only installs shims, and the previous single-stage build got pnpm baked in for free as a side effect of running `pnpm install` in the same stage. The container was fetching it from the npm registry on its first start instead, a new (and unnecessary) runtime network dependency. Now forced at build time (`pnpm --version`, right after the manifests it reads its pin from are in place). Verified with `docker run --network none`.

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
