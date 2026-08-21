# Changelog

All notable changes to CAST. Format: `knowledge/conventions/changelog-and-releases.md`.

Product version: `MAJOR.MINOR.PATCH.CORRECTION` (MAJOR `0` until `1.0` is declared).
Build stamp: `YYMM###` (year, month, build # within that month). Each entry carries an ISO-8601 UTC timestamp.

Change types: **Added · Changed · Fixed · Removed · Deprecated · Security**.
Category tags: `UX · Frontend · Backend · Database · API · Integrations · Design-System · Docs · Security · Performance · Infra`.

---

## v0.16.0.1 — build 2608035 — 2026-08-21T02:19:41Z

### Changed
- [Design-System] **"Clear credentials" is no longer a standalone red button on the Integrations page** — user: *"'Clear credentials' shouldn't be a big red button available on these. Let's just go with a simple '3 dots' edit button in the corner of each integration card."* Moved into a new reusable overflow-menu primitive (`ui/Menu.tsx`, a "3 dots" trigger + popover, closes on outside click/Escape) in each card's header corner, applied to all four integration cards (ConnectWise Production/Sandbox, aisstream.io, TrackingMore). The native `confirm()` safety prompt before actually clearing is unchanged — only the button's visual prominence changed, not the confirmation step.

## v0.16.0 — build 2608034 — 2026-08-21T01:08:54Z

### Changed
- [Security] **The ConnectWise-writes safety gate is now per instance, not one global switch** — user, directly: *"The toggle for CW writes should be per instance, not global."* A single flag meant enabling writes to test against Sandbox also silently enabled real writes to Production, exactly the cross-instance risk `v0.15.0`'s credential work exists to close. `isCwWritesEnabledForInstance(instanceId)`/`setCwWritesEnabledForInstance(...)` replace the old global functions; every one of `ManageCwClient`'s five write methods gates on its own `this.instanceId`. `PUT /api/integrations/:instance/connectwise/writes` replaces the old global route. No env boot-seed either — every instance starts OFF until explicitly enabled per instance in the UI.
- [Integrations] **All "default CW instance" auto-selection is removed app-wide** — user: *"There should be no default. Either it's explicitly working with Production, or it's working with Sandbox. No automatic failover or default assumption. We cannot risk it writing to a database it shouldn't."* `CwInstance`'s `isDefault` field is gone from the API and every consumer; five Logistics Configuration pages that used to silently pick `rows.find(r => r.isDefault) ?? rows[0]` now show an explicit "Select an instance…" placeholder and fetch nothing until the user picks one. The Integrations page's "default" badge and its IMO/MMSI custom-field-caption row (unrelated to credentials, shown alongside the "default" instance's card) are both removed.
- [UX] **The ConnectWise-writes badge no longer reads as a warning when enabled** — user: *"ENABLED is currently shown in red -- as a warning -- which isn't appropriate as that should be its normal state and would be good, not bad."* `ENABLED` is now `tone="success"` (green); `disabled` is neutral gray, not `"disabled (safe)"` — neither state is inherently dangerous now that the toggle is correctly scoped per instance. System Health's ConnectWise-writes row is now a per-instance list (was one boolean sourced from Production alone, which would have hidden Sandbox writes being live).
- [Integrations] **aisstream.io and TrackingMore credentials are now fully editable in-app**, same encrypted-store + partial-merge + masked-field + test-connection pattern ConnectWise's per-instance credentials already use — no longer `.env`-only, no redeploy needed to rotate a key. Saving an aisstream key starts the AIS listener immediately if it wasn't already running. Both providers' URL fields are host-allowlisted (`aisstream.io` / `trackingmore.com` respectively, `wss://`/`https://` only) — the same SSRF/credential-exfiltration protection ConnectWise's `baseUrl` field has, since both send the real key to whatever host is configured. TrackingMore is shown with a "not yet built" note (`INIT-0018` has no sync code yet) — its credential can be entered/rotated ahead of that build-out.

### Fixed
- [Security] **The shipment detail page — the app's primary CW-write surface (ticket status changes, document uploads) — silently defaulted to Production when no instance was known**, found by the security gate reviewing the above: `useLogisticsInstance("tritontech")` had a hardcoded fallback and no visible instance indicator anywhere on the page, so a bookmarked link, a pre-existing CW embed, or a fresh browser profile would land on Production without anyone choosing to. Fixed: no fallback — the page now asks explicitly which instance a ticket belongs to before any fetch or write can happen, and always shows the active instance as a badge in its header (closing a second, narrower gap the same gate found: a *stale* instance carried over from `localStorage` was still invisible even after the no-fallback fix).
- [Backend] Production's real ConnectWise credentials migration (`v0.15.0`) left `connectwise/instances.ts`'s `is_default` DB column and seed data in place but unread by design — documented as intentionally inert rather than risking a production schema migration for a column nothing consumes anymore.

### Security
- [Security] **Pre-release security gate BLOCKED the first version of the per-instance-writes change** on the shipment-detail-page default described above (High) plus two Medium findings (stale `CW_WRITES_ENABLED` docs after the env-var gate was removed; System Health collapsing per-instance writes into one Production-sourced boolean) — all three fixed, and a second, independent gate pass confirmed the fixes actually close the gaps (not self-certified) before finding one more Medium (the `localStorage`-carried-over-instance visibility gap above) and several Low findings, also fixed: the board-statuses fetch effect gated only transitively on `instance`, not directly; stale `CW_WRITES_ENABLED`/`isCwWritesEnabled()` references remained in `permissions.ts`, `vesselIdentity.ts`, and two knowledge docs; `.playwright-mcp/` (local browser-verification captures) had no `.gitignore` entry; `SystemHealth.tsx` would throw on an old API response shape during a stale-tab/deploy race. Two build-toolchain dependency advisories (`vite`, `nanoid`) surfaced during the same gate — not exploitable on this deployment (dev-server-only / not on any runtime path) — logged to `INIT-0034` rather than fixed here, matching that initiative's existing deferred-finding pattern.
- [Security] The new AISStream/TrackingMore credential routes apply the same host-allowlist validation ConnectWise's `baseUrl` field has (`assertValidAisstreamUrl`/`assertValidTrackingmoreUrl`) — added proactively alongside the new surface, not found by a gate, since both fields send a real secret to whatever host is configured.

## v0.15.0 — build 2608033 — 2026-08-19T01:04:32Z

### Added
- [Security] **ConnectWise credential resolution is now strictly per-instance with zero fallback of any kind** — user, directly: *"I'm not comfortable with a fallback at all for database access/reads/writes. If something goes wrong and we fallback to the wrong database, especially the Production one, we're causing real damage to data."* The legacy no-instance credential slot/functions (`resolveCwCreds()`/`saveCwCreds()`) are deleted outright; `ManageCwClient`'s instance id and `cwFetch`'s credentials are now required (not optional) at the type level, so a CW call without resolved, instance-specific creds is a compile error, not a runtime maybe. `StubCwClient` (the pre-real-keys illustrative fallback) is removed too — dead code now that every real instance has real keys. ~10 call sites across vessel tracking, vessel identity, fleet check-ins, and System Health updated to pass an explicit instance literal.
- [Integrations] **The Integrations page's "ConnectWise PSA" is now one integration with a card per registered instance** (Production, Sandbox), each with its own status, test-connection, and credentials form — not a single flat card assuming one CW company. Saves are genuinely partial: a blank field in the edit form leaves the stored value untouched, so API keys can be rotated without re-entering everything else. `clientId` is shown unmasked (it's not part of the Basic-auth secret) specifically so Sandbox's form visibly pre-fills from Production's shared value instead of requiring it typed twice.
- [Backend] New `GET/POST/DELETE /api/integrations/:instance/connectwise`, `POST /api/integrations/:instance/connectwise/test`, `GET /api/integrations/instances`. `DELETE` wipes an instance's stored credentials entirely — otherwise a leaked key pair could only ever be overwritten, never actually removed.

### Fixed
- [Backend] A real bug in the credential-merge logic, caught live while migrating: `saveCwCredsForInstance`'s partial-merge baseline read through the strict "all fields present" resolver, so a deliberately partial pre-seed (e.g. just a shared `clientId`, ahead of the rest being entered) silently vanished the moment anything else was saved on top of it. Fixed by merging against the raw stored value instead.

### Changed
- [Backend] Production's ConnectWise credentials — previously living only in `.env`, never in the encrypted store (confirmed empirically: the `secrets` table was completely empty on both dev and production before this) — were migrated in via a one-off script run directly against the live database, not re-entered. Verified by decrypting the stored value back and diffing against the source `.env` before deploying any code that depends on the store being populated.

### Security
- [Security] **Pre-release security gate BLOCKED the first version of this and found two real, live-exploitable gaps, both fixed before shipping** (independent review, `knowledge/conventions/versioning.md`'s MINOR-bump gate):
  1. **`assertValidCwBaseUrl` only ever checked the URL scheme (`https://`), never the host — despite its own comment claiming otherwise — so an `integrations.write` holder could point an instance at an attacker-controlled `https://` host and the next "Test connection" would hand that host Production's real API key pair in plaintext, plus blind SSRF from the API container.** This became materially more dangerous with this same release, since Production's real key pair now actually lives in the encrypted store it could be read from (previously it only ever came from env). Fixed with a real host allowlist (`*.myconnectwise.net` + the documented staging host) — verified live: a crafted `https://evil-attacker.com` save is now rejected with a 400 and nothing is persisted.
  2. **`GET /api/vessel-identity` had no `try`/`catch`.** It could never throw before (the pre-real-keys stub always answered), but now that the encrypted store is the sole source of truth, an unconfigured/rotated instance or any CW error reaches it uncaught — and Express 4 doesn't forward async rejections, so one authenticated GET would kill the whole API process (no error middleware, no `unhandledRejection` handler registered) in a crash loop under `restart: always`. Fixed with the same try/catch pattern every sibling route already used.
  - Also fixed, all Medium/Low findings from the same gate: the `/:instance/connectwise/test` route (returns ConnectWise's own raw error detail — useful for diagnosing a bad key, but real information disclosure) is now `integrations.write`-gated, not `requireAuth`-only — the Integrations page's nav link was already hidden from lower roles, but that never blocked direct navigation, so the backend boundary needed to actually hold; the credential-save body is now type-checked (rejects arrays/objects/numbers before they reach the encrypted store or a Basic-auth header); `baseUrl` no longer silently defaults to Production's URL for an instance that never had one set — it's a required field per instance now, with its own UI field, closing the last residual "zero fallback" gap the gate found; and the now-fully-dead `config.cwCompany`/`cwPublicKey`/`cwPrivateKey`/`cwClientId`/`cwBaseUrl`/`cwConfigured()`/`getDefaultCwInstanceId()` were removed (nothing reads them since the migration above).
- [Security] **A second, independent gate pass (re-verifying the fixes above, not self-certified) caught one more real gap in the fix itself before shipping**: the host allowlist's second entry (`staging.connectwisedev.com`) had no leading-dot anchor, so `host.endsWith(suffix)` also matched `evilstaging.connectwisedev.com` — fixed by anchoring every suffix with a leading dot and checking the bare domain separately. The re-review fuzzed 16 bypass shapes (subdomain confusion, userinfo tricks, IDN/punycode, trailing-dot FQDNs, port tricks) against the corrected logic; all denied. Two Medium findings from the re-review were deliberately NOT fixed in this release (scope discipline, not oversight) and are tracked as `INIT-0034`: a pre-existing `conditions`-string injection in `/api/tracking/preview` (unrelated to this change, needs its own dedicated fix+test pass), and raw CW error bodies still reaching low-privileged users on several OTHER routes beyond the one route this release tightened.

## v0.14.0 — build 2608032 — 2026-08-19T00:18:47Z

### Added
- [Integrations] **Logistics Configuration's Carriers and Currencies tabs are now live ConnectWise lookups, per CW instance** — replaces the old locally-managed lists (placeholder seed data, never real Triton data). Carriers reads the same `Shipment Carrier` ticket custom field (id 70) already used for outbound tracking, via `GET /system/userDefinedFields` — no dedicated custom-field-definitions REST resource exists in CW's API (`/system/customFields` 404s); this is the real one, found in the `vc3/connectwise-rest-api` client's generated types rather than by guessing paths. Confirmed live: 14 real carrier options. Currencies reads CW's Finance > Currencies setup (`GET /finance/currencies`) — endpoint confirmed correct, but the CAST API member currently lacks the Finance permission grant to read it; the UI surfaces that exact ask in its own error banner instead of failing silently.
- [Backend] New per-instance `GET /api/logistics/:instance/config/carriers` and `.../currencies`, backed by `ManageCwClient.listCarrierOptions()`/`.listCurrencyOptions()`. The carrier field's caption is configurable (`CW_CARRIER_FIELD_CAPTION`, default "Shipment Carrier") rather than hardcoded — LC's own commit history shows this exact field got renamed once in production already.

### Removed
- [Backend] The local `logistics_carriers`/`logistics_currencies` tables and their CRUD routes (`POST`/`PATCH`/`DELETE /api/logistics/config/{carriers,currencies}`) — carriers and currencies are managed in ConnectWise now, not duplicated in CAST.

## v0.13.4.1 — build 2608031 — 2026-08-19T00:06:46Z

### Changed
- [UX] Logistics Configuration's "Ship As Companies" tab relabeled to "Branding / Ship As".

## v0.13.4 — build 2608030 — 2026-08-18T23:55:05Z

### Fixed
- [Design-System] **Inconsistent field heights across Logistics Configuration forms** — reported live from the "Add Company" modal: some inputs (Name, City/State/Zip, Phone/Email, Tax ID/EIN/VAT/EORI) rendered at ~18px tall instead of the standard 36px, and sat visibly misaligned against sibling fields in the same row. Root cause: `className="grow"` (`flex: 1`) was applied to the `<Input>` inside a `<Field>`, but `.field` is itself a `flex-direction: column` container — `flex-basis: 0%` applies to the *vertical* axis there, not horizontal, collapsing the input's height instead of doing anything useful for width (which `.field`'s own default `align-items: stretch` already handled, with or without that class). Removed the misapplied class from all 10 affected inputs; a code comment now flags this specific footgun for `.grow`. Also added a `.top` alignment utility and applied it to these fields' `.row` wrappers, so a field with a hint no longer sits visibly offset from a sibling field without one.

## v0.13.3 — build 2608029 — 2026-08-18T23:26:58Z

### Fixed
- [Backend] **Logistics' Production instance ("tritontech") now reuses CAST's existing ConnectWise credentials** instead of requiring a duplicate entry — reported live: Outbound Shipments failed to load with "ConnectWise is not configured for instance 'tritontech'" even though CAST's main CW integration is already connected. `resolveCwCredsForInstance()` now falls back to the legacy single-instance credential resolution, but **only for the registered default instance** — Sandbox (`tritontech_cs1`) and any other non-default instance still throw loudly if unconfigured, preserving the deliberate safety property that a misconfigured instance can never silently read/write the wrong ConnectWise environment. This was already the recorded plan (`INIT-0026`, 2026-08-14 — "reuse the existing production keys for tritontech") but had never actually been wired up.

## v0.13.2 — build 2608028 — 2026-08-18T23:18:13Z

### Changed
- [UX] **Logistics Configuration is now the main `/logistics` page itself**, not a separate page one click away — reorganized on direct request. The old landing page's embed-link generator becomes a new "Embed Links" tab alongside Ship As Companies/Carriers/Currencies/Export Presets/CI Flags/Receiving; the old `/logistics/config` route now redirects to `/logistics?tab=branding` rather than 404ing for any old bookmark or embed link.

## v0.13.1 — build 2608027 — 2026-08-18T23:05:50Z

### Changed
- [Backend] Vessel Site `addressLine1` coordinates now round to 5 decimal places (~1m precision — more than sufficient for a vessel two orders of magnitude larger than that) and are comma+space-joined (`43.58741, 7.13141`) — supersedes the previous day's explicit "whatever the feed gives, no space" call. Flows through to both the real ConnectWise write and the Vessel Location preview table, since both are driven by the same `formatSiteUpdate`.

## v0.13.0 — build 2608026 — 2026-08-18T22:47:03Z

### Added
- [UX] **System Health redesigned around real resource-usage visualization** (`INIT-0016`, dataviz skill) — radial gauges for CPU/memory/storage, an event-loop-lag stat tile, and six time-series charts (CPU, memory, event-loop lag, disk I/O, network I/O, storage), each with hover crosshair+tooltip, direct end-labels, and a table-view fallback so every value stays reachable without hovering.
- [Backend] New `GET /api/health/metrics` (`health/metrics.ts`) — a 15s-interval in-memory sampler (3h ring buffer) reading real per-container CPU/memory/disk-IO/network from docker-proxy's `STATS` endpoint (deliberately not `os.totalmem()`/`loadavg()`, which report the *host's* raw numbers even from inside a container) and storage via `fs.statfs` on the data bind mount.
- [UX] The Docker Containers table gained inline per-container CPU/memory bars and disk-IO throughput; the Application card gained API process uptime and database file size.
- [UX] Two new System Health probes: **TLS certificate expiry** (danger under 7 days left, warn under 21) and **backup freshness** (danger past 48h stale, warn past 30h). Backup freshness reads a new read-only `api` mount of `/opt/cast/backups` (`stat()` only — name/size/mtime, the root-600 archives themselves stay unreadable). TLS expiry deliberately does NOT mount `/etc/letsencrypt` — live verification on `trt-cast-01` found certbot hardens its archive dir to `0700 root:root`, so a file-read approach would have silently never worked; it does a real TLS handshake to `web:443` over the internal Docker bridge instead, reading the exact cert nginx actually serves.
- [Backend] New `GET /api/health/integration-metrics` (`health/integrationMetrics.ts`) — ConnectWise response latency and AIS Tier 1/2 message-processing latency, charted over time. Reuses calls System Health already makes every ~15s rather than adding new polling load; TrackingMore deliberately excluded (no existing periodic call to piggyback on, and it's metered).
- [Design-System] New `RadialGauge` and `TimeSeriesChart` primitives, plus validated chart-color tokens (`--chart-series-1`/`-2`) — `--chart-series-2` passes the dataviz skill's CVD-safety validator against both the light and dark surfaces, reused identically across every 2-series chart on the page.

### Changed
- [Infra] `docker-proxy`'s allow-list gained `STATS` (read-only per-container resource counters) alongside the existing `CONTAINERS`.
- [Backend] `/api/health/full`'s event-loop-lag reading now comes from the metrics sampler instead of resetting the histogram directly in the route — the route and the sampler both reading it independently would have each only seen a fraction of the real window.

### Fixed
- [Frontend] Card content now wraps long unbroken strings (e.g. a filesystem path in an error message) instead of overflowing the card boundary into whatever sits next to it.
- [Frontend] A duplicate React key in `TimeSeriesChart`'s x-axis labels when a chart has exactly one sample (both the "first" and "last" tick resolved to index 0) — caught live via a real single-sample chart, not by inspection.

### Security
- [Security] **Pre-release security gate PASSed and found one real gap, fixed before shipping** (independent review, `knowledge/conventions/versioning.md`'s MINOR-bump gate): all five `/api/health/*` routes were gated on bare `requireAuth` instead of the `system.read` permission the codebase already declares for exactly this purpose (`auth/permissions.ts`) — no practical exposure today (every role holds `system.read`), but the routes would have kept serving silently after any future narrowing of that permission. Now uses `requirePermission("system.read")`, matching every other route file's convention. Two lower-severity infra notes (an unpinned `docker-proxy:latest` tag; the metrics endpoint returning its full ring buffer with no range param) were reviewed and deliberately deferred — logged in `INIT-0016`.

### Docs
- [Docs] `design-system.md`, `cast-web-app-deployment.md`, root `CLAUDE.md`, and `INIT-0016` (`Initiatives-Open.md`) updated to reflect all of the above.

## v0.12.0 — build 2608025 — 2026-08-18T02:45:45Z

### Added
- [Security] **A controlled-rollout allowlist now gates real Vessel Site writes**, on top of (not instead of) the existing `cwWritesEnabled` safety flag — asked for directly before enabling real writes for the first time: *"Can we gate the initial push so we control it and can test with a few at a time?"* Default (unset) is an empty allowlist — writes to nobody, even once the master flag is on — with `"all"` as an explicit graduation sentinel that can never be an accidental default. New `GET`/`PUT /api/tracking/vessel-site-write-allowlist`.
- [UX] **The Vessel Location tab is now the control surface for the allowlist** — a page-level "Vessel Site writes" selector (Allowlist only / All tracked vessels) plus a per-vessel checkbox, live-persisted on toggle. A `Badge` in each vessel's always-visible header shows "CW write: ON" at a glance without expanding; the status banner reflects both gates together, since either one being off means nothing writes.

### Changed
- [UX] "Will write:" relabeled to "CW Site Name set to:" — more literal about what the line shows.
- [UX] The no-position-data-at-all case now shows bare "Vessel" instead of the string "No signal received yet" — matches the "expired" tier's own text, so both "never had data" and "had data, now too stale to trust" render identically and honestly: this is what the CW site name actually is (or would be), not a description of why.

### Security
- [Security] **Pre-release security gate BLOCKED the first version of this and found a real, live gap** (independent review, `knowledge/conventions/versioning.md`'s MINOR-bump gate): `reconcileVesselSites()`'s auto-create path (`rule.autoCreateVesselSite`, runs on the same scheduled cycle as the Vessel Site writes) calls a real ConnectWise write (`createVesselSite`) that was gated only by the master `cwWritesEnabled` flag — not by the new allowlist at all. Confirmed live in production before writing the fix: `autoCreateVesselSite` is `true` today, so this was not theoretical — the first tier-refresh cycle after enabling writes would have auto-created a new "Vessel" site on every matched company lacking one, the exact "everything at once" outcome this feature exists to prevent. Fixed: auto-create now also requires `isVesselSiteWriteAllowed()`. Also fixed: the page's two write-status checks silently swallowed fetch failures and defaulted to showing "writes are OFF" — a transient request failure could make the one page whose purpose is showing the true write state confidently show the wrong one; now shows an explicit "couldn't confirm write status" banner with a retry instead. And switching straight to "All tracked vessels" fired immediately with no confirmation; now uses the same confirm-modal pattern already established on the Integrations page.

### Docs
- [Docs] `knowledge/architecture/vessel-location-updating-aisstream.md` §8 and `naming-lexicon.md`'s new **Vessel Site Write Allowlist** entry — including why this is a second, narrower gate layered on the existing shared `cwWritesEnabled` flag rather than a replacement for it, and why it's deliberately not called a "pin" or "exclude" (a different, previously-rejected concept from the priority/tier-split engine).

## v0.11.0 — build 2608024 — 2026-08-18T02:11:08Z

### Added
- [UX] **Confidence-tiered Vessel Site writes** (`INIT-0012`) — replaces the flat 6-hour staleness cutoff entirely. Every write is now colored by how much CAST still trusts it: 🟢 current (≤2h), 🔵 presumed (a stationary vessel persists indefinitely; an underway vessel with a destination+ETA persists through ETA+48h), 🟠 stale (no reasoning basis left — underway with no destination, aground, or an unrecognized nav-status code — but still shown, never silenced). Past a configurable fallback (default 90 days, runtime-adjustable without a redeploy) with nothing fresher at all, the site name reverts to a bare, unstatused "Vessel" rather than keep aging a guess. Aground deliberately does NOT get the same indefinite persistence as docked/anchored — it's an incident, not a resting state; real alerting on it belongs to `INIT-0017`, not this color scheme.
- [Backend] **A new "Last AIS Data Update" custom field on the Vessel Site** (Text type, user-created live) now carries the true last-confirmed timestamp in every tier, including once the name has reverted to a bare "Vessel" — so staleness stays honestly visible even when the status text itself can no longer say anything specific.
- [Integrations] **The Vessel Site's Time Zone is now resolved and written automatically from the vessel's coordinates** — a real ConnectWise `timeZoneSetups` reference (a fixed 94-entry list using Windows-era city labels, not IANA names — verified live against the real API, distinct from the differently-named `/system/timeZones` endpoint). Coordinates → IANA zone via `tz-lookup` (covers open ocean too) → the closest CW entry by live-computed current UTC offset, with geographic distance as an explicit tiebreak among the many entries that share an offset. Falls back to the vessel's resolved current place (never `destination` — that's where it's headed, not where it is) only if the coordinate lookup itself fails.
- [UX] **The Vessel Location tab now previews the exact write**, not just a description of it — each vessel's always-visible area gained a "Will write: …" line plus a Position / Destination / ETA / Last-confirmed table, both driven by the identical function that produces the real ConnectWise write.
- [Design-System] `Disclosure` gained a second, always-visible `subheader` zone, separate from the clickable header — needed because the new write-preview table can't legally live inside a `<button>`.

### Changed
- [Backend] Vessel Site `addressLine1` drops the space after the comma (`43.58741,7.131405`, not `43.58741, 7.131405`) — coordinates were already written at native feed precision before this release (no rounding in either version); this only changes the separator.
- [Backend] `addressLine1` and the resolved Time Zone are now omitted (left untouched, not cleared) once a vessel's confidence has fully expired — consistent with the name reverting to "Vessel": no current confidence in a position means not asserting one anywhere.

### Fixed
- [Backend] **Real bug found live-testing against real production position data before shipping:** the Time Zone matcher's first pass picked whichever CW entry came first in the list among several sharing the same current UTC offset — a Greek vessel resolved to "Amman" over the obviously-correct "Athens, Bucharest, Istanbul" entry, since both currently sit at +3 (Jordan dropped DST in 2022). Fixed by adding geographic distance as an explicit tiebreak.
- [Backend] Aground was initially implemented with the same indefinite-persistence treatment as docked/anchored — a mismatch against what was actually specified (aground should decay like underway-with-no-destination, given it's an incident state, not a resting one). Corrected before shipping.

### Performance
- [Backend] The Time Zone matcher recomputed all 94 CW `timeZoneSetups` entries' current UTC offsets (each a real `Intl.DateTimeFormat` construction) for every vessel, even though that table only depends on the current time, not which vessel — up to ~5,600 redundant Intl calls per 5-minute tier-refresh cycle. Found answering a direct question about this feature's load before shipping; now cached per real-world minute, so a whole batch shares one computation. Measured, not estimated: a simulated full 60-vessel batch runs in ~550ms total (~9ms/vessel) after the fix, dominated by the pre-existing nearest-port lookup, not this code.

### Security
- [Security] **Pre-release security gate findings, fixed before this release shipped** (independent review, `knowledge/conventions/versioning.md`'s MINOR-bump gate — verdict PASS, both Medium/Low): the AIS listener had no runtime numeric validation on `Latitude`/`Longitude`/`Sog`/`Cog`/`NavigationalStatus` — a malformed or non-numeric value from the feed would have flowed straight through to a live ConnectWise write (`addressLine1`) or thrown in the frontend's history table (`.toFixed()` on a non-number). Now coerced to `null` (the existing, already-tolerated "no data" case) unless genuinely finite. The raw AIS `destination` field (unauthenticated, crew-entered, spoofable by design) had no length cap before landing in a ConnectWise Site name — capped at 20 characters, the real ITU-R M.1371 protocol limit for that field. A malformed `CAST_VESSEL_STATUS_FALLBACK_DAYS` env value would have silently produced `NaN`, which fails the expiry check OPEN rather than closed (a stale status could never expire) — now validated, falling back to the documented default. The "Last AIS Data Update" custom-field write silently no-op'd if the CW field caption ever stopped matching, with no way to notice — now logs a warning.

### Docs
- [Docs] `knowledge/architecture/vessel-location-updating-aisstream.md` §7, `naming-lexicon.md`'s new **Confidence Tier** entry, and `Initiatives-Open.md`'s `INIT-0012` updated with the full redesign — including a considered-and-declined note on MMSI→flag-country lookup (would sit alongside fields that represent current location, and flag state isn't one) and what the AIS feed carries but CAST still doesn't parse (`ImoNumber`, vessel dimensions, heading, and more — feeds a future `INIT-0014` pass if pursued).

## v0.10.0 — build 2608023 — 2026-08-17T22:09:18Z

### Added
- [UX] **Vessel Location tab is now real** (`INIT-0012`, `INIT-0033`) — a collapsible tree, one row per vessel with live AIS coverage (Monitoring Tier 1/2), alphabetical by vessel name. Each row shows Tier, Navigational Status, and the exact text that would be written to that vessel's ConnectWise Vessel Site if writes were enabled (`formatSiteUpdate` — same function the real write path uses, so this page can never drift from what CW would actually see). Expanding a vessel lazily loads its most recent received updates (position and voyage messages, newest first); a "History per vessel" selector controls how many (10/20/50/100). Replaces the fully illustrative stub table this tab has shown since scaffolding — the old "Target Location" column header is gone (superseded terminology, `naming-lexicon.md`).
- [Backend] **`vessel_position_history` table** (`INIT-0033`) — insert-only, one row per real AIS update received (not a synthetic periodic snapshot), written alongside every existing `vessel_positions` upsert. This is the first version of the fleet-history capture scoped in `INIT-0033`; nothing before this deploy is backfilled, since no history existed to backfill (the AIS listener only started successfully parsing messages this same day, `v0.9.2`).
- [API] Two new endpoints: `GET /api/vessels/tracked` (every Tier 1/2 vessel with its current formatted status) and `GET /api/vessels/history/:mmsi?limit=N` (that vessel's most recent received updates, newest first).
- [Design-System] New `Disclosure` primitive (`ui/Disclosure.tsx`) — a collapsible header/body row, the first reusable expand/collapse pattern in the app.

### Fixed
- [Backend] History rows initially sorted by insertion order (`id`), which could show an earlier-timestamped row above a later one — a position row's timestamp is the AIS station's own self-reported time, while a voyage row's is CAST's receipt time, two clocks with no shared ordering guarantee. Found live-testing the new Vessel Location tree in a browser before shipping (seeded fixture data reproduced it directly). Now sorts by the displayed `recorded_at` timestamp, with `id` only as a tiebreak.

### Security
- [Security] **Pre-release security gate findings, fixed before this release shipped** (independent review, `knowledge/conventions/versioning.md`'s MINOR-bump gate — verdict PASS, these were Medium/Low): `vessel_position_history` had no retention or row cap, growing unbounded on the same SQLite file as the encrypted secrets table and local accounts — a third party's message rate, not CAST's own code, would have decided that table's size. Now capped at 5,000 rows per MMSI, pruned periodically via the existing `(mmsi, id DESC)` index rather than a new scan. The two new read routes (`GET /vessels/tracked`, `GET /vessels/history/:mmsi`) and the two pre-existing ones in the same file used bare `requireAuth` where a `vessel.read` permission already exists elsewhere in the app — switched to `requirePermission("vessel.read")` for consistency (no behavior change for any current role, all of which already hold it; closes the gap for a future role that might not). The MMSI route param now requires exactly 9 digits (the real ITU-R M.1371 format), not just any digit string.

## v0.9.2 — build 2608022 — 2026-08-17T21:12:40Z

### Fixed
- [Backend] **The AIS listener could never read a single message — aisstream sends binary WebSocket frames, and we were parsing them as text.** Node's native `WebSocket` hands a binary frame back as a `Blob`, so `aisListener.ts`'s `JSON.parse(String(ev.data))` was parsing the literal string `"[object Blob]"` and throwing on every message ever received. Now sets `binaryType = "arraybuffer"` and decodes explicitly (still accepting text frames if the server ever sends them). This is a **separate defect from the aisstream outage** that ran 2026-08-05 → mid-August and was blamed for the same symptom: both were real at once, and the outage ended first. Proven before changing any code — `vessel_positions` had **0 rows, ever**, on production (while `checkins` had 5, ruling out the database), and a probe run *inside the production `cast-api` container* returned live `PositionReport`/`ShipStaticData` frames whose `ev.data` was a `Blob` under the container's own Node 22. Verified fixed end to end by running the real listener module against the live feed with the production key and the real 50 Tier 1 MMSIs: 5 frames, 0 parse failures, 5 positions stored with real coordinates and nav status. Note this is *not* a field-name or protocol-format problem — v0.8.2's field-name cross-check was and remains correct; this sits a layer below it, at frame encoding.
- [Backend] **The message-rate gauges counted only messages that parsed successfully**, which is what let the bug above hide for six days: an unreadable feed and a dead feed rendered byte-for-byte identically (`0 msg/min, connected=true`). Frame counters now increment *before* parsing, so the gauge means "a frame landed", not "a frame parsed". (v0.8.1's changelog claim that "the message-count gauges increment before field parsing" was true of *field* parsing and false of *JSON* parsing — the distinction that mattered.)

### Added
- [Backend] New `parseFailuresTotal` gauge per AIS connection, surfaced in the 60-second status line as `badFrames=`, with a rate-limited warning (first failure, then every 100th). "Live feed we can't read" is now a distinct, visible state rather than one indistinguishable from an outage — the durable lesson being that a health gauge which only increments on the success path cannot report the failure it exists to catch.

### Docs
- [Docs] New §5 in `knowledge/architecture/vessel-location-updating-aisstream.md` recording the above, including the diagnostic guidance that follows from it: a *low* msg/min is normal (moored yachts transmit every few minutes — ~5 of 50 vessels reported in a 2-minute window), so read `badFrames` and the `vessel_positions` row count rather than message rate when judging listener health.

## v0.9.1.1 — build 2608021 — 2026-08-14T18:11:56Z

### Fixed
- [Infra] `scripts/deploy.sh` now refuses to run as root — running it via `sudo` (rather than as `tritonadmin` directly) breaks `git fetch`, since the deploy key + its SSH host alias live in `tritonadmin`'s `~/.ssh`, not root's. `tritonadmin` is already in the `docker` group, so sudo was never actually needed for any step in the script.

### Docs
- [Docs] `knowledge/architecture/cast-web-app-deployment.md` updated for `v0.9.0`'s infra changes it had missed: the API container's non-root entrypoint + Chromium sandbox, the internal-only nginx `:8080` listener, and the `deploy.sh` root-user gotcha above.

## v0.9.1 — build 2608020 — 2026-08-14T18:09:11Z

### Fixed
- [UX] Logistics' "Copy embed link" produced the identical URL regardless of which CW instance (Production/Sandbox) was selected — the link never encoded the instance at all, and none of the destination pages (Outbound Shipments, Shipment Detail, Receiving settings) read it back from the URL either, only from this browser's own `localStorage` — so even a correctly-built link would land on the wrong instance the moment it was opened somewhere without matching local state, which defeats the entire point of an embed link. New shared `useLogisticsInstance` hook (URL `?instance=` takes priority, `localStorage` is the fallback for direct dev/test nav) now backs all four instance-aware Logistics pages; verified live by clearing `localStorage` entirely and opening a copied Sandbox link fresh.
- [Frontend] The Commercial Invoice and Packing List editors each hardcoded their own independent copy of the Incoterms list instead of using `GET /api/logistics/config/incoterms` (built in Phase 1 specifically to centralize this) — found while auditing for the same "duplicated instead of centralized" pattern as the fix above. Now threaded through as a prop from a real fetch, like every other Configuration-driven option list on those two components.

## v0.9.0 — build 2608019 — 2026-08-14T16:16:24Z

### Added
- [UX] **New "Logistics" workspace section** (`INIT-0026`, Phases 0-3 of a native rebuild of the standalone LogisticsCoordinator app into CAST) — a new nav entry, landing on an embed-links page (day-to-day usage is embedding these pages inside ConnectWise via Custom Menu Entry Links, not direct navigation; direct routes remain for dev/test).
- [Backend] **Multi-instance ConnectWise architecture** — CAST can now hold fully independent, simultaneously-usable Production and Sandbox ConnectWise contexts. Each CW instance gets its own SQLite file (`cast_{instanceId}.db`) and its own encrypted credential slot; every Logistics route is scoped by instance in its URL, and an instance with no credentials configured throws loudly rather than silently falling back to another instance's credentials — a hard safety property, not an oversight.
- [UX] **Logistics Configuration** — 6 tabs: "Ship As" companies (with logo upload), Carriers, Currencies, Export Statement Presets, CI Flags, and per-instance Receiving settings (which live ConnectWise PO statuses count as open, sync cadence).
- [UX] **Outbound Shipments** — a live-refreshing list of ConnectWise Shipping Request tickets (Service + Project, merged), with sortable/filterable columns and per-ticket item counts. This is a genuinely live CW query, not a local cache — mirrors how the legacy tool worked.
- [UX] **Shipment detail** — header (company/summary/site, ship-by/due-by dates, a live CW ticket-status editor) plus a Packing / Pack by Barcode / Documents tab shell (Packing lands in a later phase).
- [UX] **Commercial Invoice & Packing List generation** — the Documents tab renders a fully editable invoice/packing-list view (shipper, consignee, ship-to, incoterm/carrier/currency, per-line description/HS-code/country-of-origin/pricing overrides, CI flags, export statements) and can Export a PDF or Post it directly to the ConnectWise ticket as an attachment.
- [Backend] **Playwright as a production dependency** — CAST now generates PDFs by launching a real headless browser against its own app and rendering the same interactive Commercial Invoice / Packing List screen, the same pattern the legacy tool used. A new internal, short-lived service credential lets that headless render reach the app's normal authenticated data endpoints without a real login session.
- [Integrations] New ConnectWise API capabilities: live Shipping Request ticket queries, per-ticket product-quantity totals, ticket detail/board-status reads, ticket status writes, and document (PDF) uploads to a ticket.
- [Database] New shared tables (`logistics_companies`, `logistics_carriers`, `logistics_currencies`, `logistics_export_presets`, `logistics_ci_flags`) and a new per-CW-instance schema (`shipments`, `containers`, `container_items`, `catalog_item_cache`, `documents`, plus the receiving/allocation tables Phase 5-6 will use).

### Fixed
- [Backend] `api.ts`'s shared request helper crashed parsing a 204 No Content response as JSON — this silently broke every DELETE across the app (the request succeeded server-side, but the UI showed an error toast and never refreshed the list). Found while testing the new Documents tab's status-write flow; also affects every Configuration delete button shipped in this same release.
- [Backend] Two bugs in this release's own new code (not inherited from the legacy tool): `container_items` was missing a plain `description` column entirely (only had the override column), and Commercial Invoice box-placement labels (e.g. "Pallet 1 | Box 3") resolved the wrong container's number when a box's parent pallet itself held no items directly.

### Security
- [Security] The legacy tool has two known live defects — an invalid enum value sent by its "Reset Field"/"Reset" actions, one of which throws a database error on any shipment with packed items — that are deliberately **not** carried into this rebuild; CAST represents "no override" as a null value that can't produce an invalid state.
- [Security] **Pre-release security gate findings, fixed before this release shipped** (independent review, `knowledge/conventions/versioning.md`'s MINOR-bump gate): a shipment-update endpoint let a request body's `id` field silently override which record was actually written, independent of the URL; the new PDF-render pipeline built its internal navigation URL from an unvalidated shipment id and minted its internal service credential with full admin privilege rather than the read-only scope it actually needed; the API container ran as root with Chromium's OS sandbox explicitly disabled in the same container that decrypts every stored ConnectWise credential. All four fixed — shipment ids are now validated as numeric CW ticket numbers wherever they flow into the render pipeline, the internal render credential is scoped to read-only, and the API container now runs as an unprivileged user with Chromium's real sandbox enabled (validated with a real local Docker build/run, not just code review). Also added: a concurrency cap on PDF rendering (unbounded concurrent Chromium launches could exhaust the deploy host), `https://`-only validation on ConnectWise credential URLs, baseline nginx security headers (HSTS/CSP/nosniff/frame-ancestors), and the previously-unreachable per-instance ConnectWise credential save endpoint (existed since Phase 0 but no route ever called it).
- [Infra] New internal-only nginx listener (port 8080, not published to the host) so the API container's headless-browser PDF render can reach the SPA without hitting the public HTTPS certificate (issued for the public hostname, not the internal Docker network name) or the port-80 redirect that would otherwise send it into a certificate mismatch — mirrors the legacy tool's own proven internal-routing pattern.

### Docs
- [Docs] New `knowledge/architecture/logistics-packing-shipping-behavior-spec.md` — an exact, source-verified behavior spec for the legacy tool's Assembly workspace and Document generation, the reference this rebuild (and its still-pending Phase 4) is validated against.

## v0.8.2 — build 2608018 — 2026-08-11T05:59:13Z

### Fixed
- [Backend] **Reverts v0.8.1's `MetaData`→`Metadata` change — that was wrong.** Cross-checked every field name used in `aisListener.ts` against three independent authoritative sources (aisstream's docs page's own JSON example, their auto-generated OpenAPI models at `github.com/aisstream/ais-message-models`, and a complete working Go reference implementation at `github.com/aisstream/example`): all three confirm `MetaData` (capital M and D) was correct all along — the v0.8.1 "fix" was based on a less-authoritative read of the same docs page and introduced a regression. Also confirms every other field name already in use (`APIKey`, `BoundingBoxes` coordinate order, `FiltersShipMMSI`, `FilterMessageTypes`, `Latitude`/`Longitude`/`Sog`/`Cog`/`NavigationalStatus`/`Destination`, and `aisEta.ts`'s `Month`/`Day`/`Hour`/`Minute`) was already exactly correct — none of it needed changing. Full narrative: `knowledge/architecture/vessel-location-updating-aisstream.md` §4. This does not explain the separate zero-messages-received symptom under investigation — with the request/response format now conclusively ruled out, that looks like an aisstream-side account/service issue rather than a CAST defect.

## v0.8.1 — build 2608017 — 2026-08-11T05:29:56Z

### Fixed
- [Backend] aisstream's server message envelope uses `Metadata` (only the leading letter capitalized) — `aisListener.ts` read it as `MetaData` (capital D), confirmed by fetching aisstream's actual API docs directly rather than continuing to guess. This wouldn't have caused the "zero messages received" symptom being investigated (the message-count gauges increment before field parsing), but it would have silently dropped every position/voyage update's MMSI once real data does start flowing. Found while diagnosing why a freshly-rotated aisstream API key still showed 0 msg/min in production; the subscribe message format itself was independently confirmed correct against the same docs (field names, nesting, coordinate order — aisstream states coordinate order "has no effect"). No error response (`{"error": "Api Key Is Not Valid"}`, aisstream's own documented shape) was ever received across either key, ruling out an invalid-key explanation — root cause of the zero-message symptom remains open, likely an aisstream-side account/service issue rather than a CAST defect.

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
