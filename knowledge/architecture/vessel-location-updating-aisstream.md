---
status: active
read-when: Designing or building Vessel Location Updating (INIT-0012) — the AIS data source, the IMO→position pipeline, the Tier 1/Tier 2 priority split, or the ConnectWise status/location write-back.
related: [cast-web-app-mockup.md, cast-web-app-vm-provisioning.md, ../decisions/0002-extension-never-touches-cw-credentials.md, ../conventions/naming-lexicon.md]
updated: 2026-08-11
---

# Vessel Location Updating — AIS data source (aisstream.io)

The chosen data source for **Vessel Location Updating** (`INIT-0012`): pull each
vessel-client's live position/status and write it into a ConnectWise location's
address field on a schedule. This file records what aisstream.io actually is and
the design consequences that follow — read before building the pipeline.

> **Why this source.** `INIT-0012`'s open blocker was data-source legality:
> MarineTraffic's ToS prohibits automated scraping. **aisstream.io provides a
> legitimate API** (free, beta), which clears that blocker. Found by a colleague,
> 2026-07-22.

## 1. Credentials — where the key lives

- API key is a **server-side secret** (`knowledge/decisions/0002`). It lives in
  `components/api/.env` as `CAST_AISSTREAM_API_KEY` (git-ignored), read via
  `components/api/src/config.ts` (`config.aisstreamApiKey`, `aisstreamConfigured()`).
  **Never** in the SPA, in `knowledge/`, or in `.env.example`.
- Get/rotate a key at <https://aisstream.io> (free, GitHub sign-in). If a key is
  ever exposed, rotate it there and update `.env` only.
- Docs: <https://aisstream.io/documentation>.

## 2. API model (verified from the docs, 2026-07-22)

- **WebSocket stream, NOT REST.** Connect to `wss://stream.aisstream.io/v0/stream`
  (`config.aisstreamWsUrl`). A **subscription message must be sent within 3 s** of
  connecting or the socket closes. Auth is the API key inside that subscription
  message, over WSS only.
- **Subscribe by:** one or more **bounding boxes** (required — geographic
  lat/lon areas), optionally an **MMSI filter (max 50)**, optionally a
  **message-type** filter (AIS message type, e.g. `PositionReport` vs
  `ShipStaticData` — **not** vessel type). Subscription updates throttled to
  **1/second**. There is **no server-side vessel-type filter** (can't ask for
  "yachts only"); ship type lives only in `ShipStaticData` /
  `ExtendedClassBPositionReport`.
- **"Receive everything and discard" is NOT viable.** The bounding box is
  mandatory; a global box with no MMSI filter = the whole planet's feed, and
  aisstream **closes your connection if your queue backs up** (budget ~300 msg/s
  even for a global subscription). Never the fallback — the **known MMSI list is
  the filter**, and it's more precise than any type filter would be.
- **Delivers 24+ AIS message types.** The two that matter here:
  - **`PositionReport`** / **`StandardClassBPositionReport`** — lat/lon, course
    over ground, speed over ground, **navigational status**, heading, timestamp.
  - **`ShipStaticData`** — carries **`ImoNumber`**, name, dimensions, etc.
- **Beta, no SLA.** Connections can drop if the server queue backs up; expect to
  handle bursts (~300 msg/s) and to **reconnect with backoff**. Data is a global
  network of AIS stations (crowdsourced terrestrial receivers).

## 3. Design consequences (these shape the whole feature)

1. **Push stream, not a lookup — inverts the model.** `INIT-0012` was first
   imagined as "on a schedule, look up each IMO → get position." aisstream
   doesn't answer point queries; it *pushes* messages for vessels inside your
   bounding boxes as they transmit. So the pipeline is two halves:
   - a **long-lived listener** (persistent WS, reconnecting) that keeps a
     *latest-known position+status per vessel* cache, and
   - a **scheduled writer** (the existing `node-cron` job,
     `jobs/vesselSync.ts`) that reads that cache and writes into ConnectWise.
   The listener is a new long-running concern the Express process (or a worker)
   must own — it is not itself a cron job.

2. **IMO ≠ MMSI — a mapping is required.** Position reports are keyed by
   **MMSI**; the **IMO number only appears in `ShipStaticData`**. Client records
   carry the **IMO** (permanent). So we must resolve IMO→MMSI, either by:
   - capturing `ShipStaticData` (which contains *both*) to build/maintain the
     mapping, and/or
   - **storing MMSI alongside IMO on the CW company record** (recommended — MMSI
     is what AIS actually filters on, and the 50-MMSI subscription filter needs it).
   Note MMSI can change (reflag/ownership); IMO cannot — treat the mapping as
   refreshable, not fixed.

3. **Coverage is shore-biased — which happens to suit us.** Crowdsourced
   terrestrial AIS has **excellent coverage near ports/coasts and gaps in open
   ocean.** Since the point is detecting docked/moored/anchored vessels and
   updating an address, the high-value states are exactly the well-covered ones.
   An open-ocean "underway" vessel may simply not report for a while — the
   pipeline must tolerate *stale/absent* data (keep last-known + a timestamp,
   don't blank the address on a gap).

4. **Output is a friendly status — a mapping table (DECIDED 2026-07-22).** The
   desired output is a human label ("Moored / At anchor / Under way"), *not* the
   raw AIS code and *not* a street address. AIS nav status is a code set
   (0 = under way using engine, 1 = at anchor, 5 = moored, 6 = aground,
   8 = under way sailing, …) → map to the friendly labels with an explicit table.
   **"Dry-docked" is not an AIS status** (a vessel in dry dock is powered down and
   transmits nothing) — it surfaces as the **"no recent signal / unknown"** bucket,
   not a distinct code. So the deliverable is: (status mapping table) + (a
   stale-signal bucket keyed on last-seen timestamp).

5. **Location is a friendly place name — nearest-port lookup, NOT street-address
   geocoding (DECIDED 2026-07-22).** The user wants an "appropriate location"
   (e.g. a port/anchorage name), not a postal address — so no land-oriented
   reverse-geocoder (they return nothing useful for a vessel at sea anyway).
   Instead: lat/lon → **nearest named port/anchorage** via a small **offline
   world-ports dataset** (World Port Index / UN-LOCODE, ~thousands of ports, free)
   and a nearest-neighbour by distance. No API, no rate limit.
   **Make location status-dependent:**
   - *Moored / at anchor* → nearest port/anchorage from lat/lon (reliable — the
     vessel is physically there).
   - *Under way* → prefer the crew-entered **destination** field from AIS voyage
     data (`ShipStaticData`, "bound for X") — more meaningful mid-transit — with
     nearest-coastal-area as fallback when it's blank/garbage.

6. **Fleet scaling — vessels travel GLOBALLY, so it's global box + MMSI filter,
   NOT regional boxes (corrected 2026-07-23).** The clients are scattered
   worldwide, so a regional bounding-box + local-filter strategy does not apply
   (a *global* box with no MMSI filter would be the entire planet's AIS feed — a
   firehose that gets you throttled/dropped). Instead:
   - **Global bounding box** (`[[-90,-180],[90,180]]`, confirmed supported) **+
     the MMSI filter** naming our vessels → those vessels anywhere on earth. The
     MMSI filter is the *right* tool for a small, globally-scattered set.
   - **≤50 vessels = one subscription.** Clean.
   - The binding limit is really **one active subscription per connection**
     (confirmed: a new subscription message is *swap-and-replace* on that socket,
     not additive). So **>50 continuous** vessels needs multiple concurrent
     connections (ceil(N/50)).
   - **Preferred way to stay ≤50:** scope the monitored set to the ConnectWise
     clients *in the relevant status* (see §4) — likely ≤50 and the correct
     product scoping anyway.
   - **If the active set exceeds 50: rotate on ONE connection.** Because we only
     *write* to CW on a schedule, we need a per-cycle snapshot, not continuous
     coverage — subscribe group 1 (global box + 50 MMSIs), listen briefly, *swap*
     to group 2, …, build the snapshot, then write. One connection/key, unlimited
     vessels. Keep last-known position + timestamp and carry it over for vessels
     that didn't transmit in their window (moored/anchored transmit slowly).
   - **DECIDED for >50 — a 2-tier priority model (user, 2026-07-23), REVISED
     to strict priority groups (user, 2026-08-11). Both the scoring/split
     half AND the WS listener consuming it are built — see §4.** Rather than making
     *all* vessels equally stale under flat rotation, split by business
     importance: **Tier 1 = the priority ≤50** on their own dedicated,
     always-on subscription (global box + those MMSIs) → *continuous/
     real-time*; **Tier 2 = the rest of the engaged set** on a second socket
     via rotation → periodic/best-effort. **A Trackable Vessel (valid MMSI +
     resolved Vessel Site) with no open Project or ticket gets NEITHER tier —
     no AIS coverage at all.** Only vessels with real, current business
     engagement are worth the resource; this is a deliberate, revised
     narrowing from the original "everyone gets at least Tier 2" design.
     Ranking is **strict groups, not additive scoring**: every vessel with an
     **open Project in a selected status** unconditionally outranks every
     vessel with only an **open ticket on a selected board** — no
     exceptions — and within a group, **most-recent activity** wins
     (`_info.lastUpdated`, present on both CW tickets and projects). **No
     manual override of any kind** — "pin" was rejected first (an arbitrary
     per-person promotion isn't a fair, formula-driven ranking), then
     "exclude" too, same day, same principle (user: *"If we want it
     excluded, we'll remove the MMSI"*) — every Tier 1/2 outcome is a pure
     formula result over live CW data. 50 is exactly the subscription cap,
     so Tier 1 is one clean subscription. Two sockets total (trivial); Tier 2
     only spins up when the engaged set exceeds 50.
     **Implementation:** `components/api/src/vessels/priority.ts`
     (`prioritizeVessels`, pure/unit-tested against 60+-candidate scenarios)
     + `CwClient.listOpenProjectActivity()` / `listOpenTicketActivity()`
     (both `Map<companyId, ISO timestamp>`, not boolean sets — confirmed live
     that this CW instance's real Project module (`/project/projects`) is in
     active use, separate from tickets on project-named boards), wired into
     `POST /api/tracking/preview` and the scheduled `jobs/tierRefresh.ts`.
     Verified live against real CW:
     294 tracked candidates → 201 with a valid MMSI → 10 with an open Project
     in "1: Active" → 99 with open ticket work on the selected boards — both
     real, meaningfully-sized signals, not rare edge cases.
     **Refresh cadence — DECIDED 2026-08-11 (user):** the Tier 1/2 split
     recomputes every 5 minutes by default, **runtime-adjustable** without a
     redeploy (`GET/PUT /api/tracking/refresh-interval`). Vessel Site
     reconciliation runs in the same cycle, fully automatic — see §4 "CW
     write target" for the local-first, self-healing design (2026-08-11,
     user). See `INIT-0012`'s fleshing-out notes for the full design
     rationale.
     **Confirmed 2026-08-11 (was ambiguous — see `INIT-0015`):** the board
     criterion is priority-only, never a Tracked-Vessel membership gate.
   - **Throttling is per-API-key AND per-user/account** — so **more API keys is
     NOT a clean capacity multiplier**; the account-level throttle is the real
     (unpublished) ceiling. Don't assume keys stack linearly. Prefer rotation /
     CW-scoping over many connections.

7. **The fleet is SUPERYACHTS — mostly Class A + IMO (refined 2026-07-23).**
   Clients are practically all superyachts, and Triton already holds IMO numbers
   for many/most. Superyachts in the SOLAS/charter tier (≥300–500 GT — having an
   IMO confirms this tier) carry **Class A AIS + an IMO**, which *reverses* the
   generic small-yacht caveats:
   - **IMO is a reliable key here** (present for many/most). **MMSI is still the
     AIS position key** and is needed for the monitor's subscription filter — so
     the reconciliation gap is predominantly **IMO→MMSI** (fill the missing MMSI
     where we have the IMO). See INIT-0014.
   - **Class A transmits the real navigational-status field**, so §3.4's clean
     code-lookup ("Moored / At anchor / Under way") applies. The Class-B
     speed-heuristic is only a fallback for any odd non-Class-A vessel.
   - **aisstream cannot fill MMSI from IMO** — you can't subscribe/lookup by IMO,
     and its opportunistic harvest only runs MMSI→IMO (the direction we *don't*
     need). So IMO→MMSI reconciliation needs a **vessel-registry source**
     (INIT-0014), not aisstream.
   - The spike should still confirm Class A + the real status field for the actual
     client vessels before we hard-code the status path.

## 4. Resolved 2026-08-11 — the full pipeline is now built

Everything below was "still open" as of the previous revision of this file.
The user resolved all of it in one session, and the full listener → cache →
writer pipeline is built end to end (not just the priority/tier-split half).

- **Position storage: no separate database.** Confirmed as originally
  guessed — latest-position-only, no history, fits the existing shared
  `cast.db` (better-sqlite3). New `vessel_positions` table (mmsi PK: lat,
  lon, sog, cog, nav_status_code, last_seen_at, plus voyage columns
  destination/eta_iso/voyage_updated_at from `ShipStaticData`) —
  `components/api/src/vessels/positionStore.ts`. Position-*history* (time-
  series, for analytics/replay) remains a genuinely separate, not-yet-needed
  concern — the boundary the original note called for.
- **Listener topology: in-process in `@cast/api`**, matching every other
  scheduled concern in this app (`jobs/tierRefresh.ts`). Native Node
  `WebSocket` (stable since Node 22, this app already targets 22 — see the
  Dockerfile) — no new dependency. `components/api/src/vessels/aisListener.ts`:
  **two independent connections**, matching the Tier 1/2 design — one
  dedicated always-on subscription for Tier 1's (≤50) MMSIs, one that
  **rotates** through Tier 2's pool in batches of ≤50 on its own 60s timer
  (independent of the 5-minute tier-refresh cadence, since Tier 2 can exceed
  the 50-MMSI cap regardless of when the pool itself last changed).
  Reconnects with exponential backoff + jitter (uncapped retries, backoff
  resets on a clean reconnect).
- **MMSI filters stay current without polling.** `jobs/tierRefresh.ts` calls
  `aisListener.applySplit()` the moment it recomputes the Tier 1/2 split
  (every 5 minutes by default, runtime-adjustable) — the listener itself
  never polls `tracking.currentSplit` on its own. On process restart, the
  listener also applies whatever split was last persisted immediately at
  boot (rather than sitting idle with zero MMSIs for up to 5 minutes waiting
  for `tierRefresh`'s first cycle).
- **Health monitoring & backpressure — the user asked directly.** aisstream
  documents that it drops connections whose consumer falls behind (~300
  msg/s budget even for the global-feed case) — the user asked for a live
  gauge of this. Two: (1) per-connection message-processing time (parse +
  sqlite upsert), tracked as a rolling last-minute avg/max on each
  connection's state; (2) a genuinely process-wide event-loop-lag histogram
  (`components/api/src/health/eventLoopLag.ts`, Node's own
  `perf_hooks.monitorEventLoopDelay` — the standard tool for "are we keeping
  up," not AIS-specific, so it also covers anything else blocking the
  process). Both surfaced on System Health (`GET /api/health/full`): AIS
  Tier 1 / Tier 2 probe cards (connection state, MMSI count, msg/min,
  reconnect count, processing time) and a "Process backpressure" card
  (event-loop lag mean/p99/max). Reconnects are never auto-flagged as
  failures beyond the reconnect counter — a beta API with no SLA will drop
  connections sometimes; that's expected, not alarming on its own.
- **Live visibility.** Structured `[ais-listener]` logs on connect/
  disconnect/reconnect/errors, plus a one-line summary every 60s (msg/min
  and connection state per tier) — not per-message logging, which could hit
  ~300/s in theory. For actual data inspection: `GET /api/vessels/positions`
  (`routes/vessels.ts`) returns the live cache contents directly.
- **Nearest-port dataset: UN/LOCODE, not NGA World Port Index** (user
  decision, reasoned from the fleet: predominantly superyachts, which mostly
  anchor/dock at small marinas and coastal towns, not major commercial
  shipping ports — NGA's ~3,700 entries are commercial-port-biased and would
  badly miss those; UN/LOCODE's ~100k+ entries cover far more of the small
  harbors yachts actually frequent). Bundled dataset:
  `components/api/src/vessels/ports.csv`, sourced from
  `cristan/improved-un-locodes`' `code-list-improved.csv` (PDDL/ODbL/CC-0 —
  UN/LOCODE data is PDDL; coordinate improvements from OSM Nominatim (ODbL)
  + Wikidata (CC-0)) — filtered from 116,075 rows (all UN/LOCODE function
  types) down to 16,657 (port/maritime function only, non-deprecated status,
  valid coordinates). Nearest-neighbor by haversine distance, capped at 50nm
  ("at sea" beyond that, not a wrong port name) —
  `components/api/src/vessels/nearestPort.ts`. Regenerate by re-filtering a
  fresh `code-list-improved.csv` download with the same criteria (see that
  file's header).
- **Nav-status → friendly-label table** (`components/api/src/vessels/navStatus.ts`):
  standard ITU-R M.1371 codes folded into `docked` (moored, 5) / `anchored`
  (1) / `underway` (0, 2–4, 7, 8 — the vessel isn't stationary, so the same
  destination-based phrasing applies regardless of exactly why) / `aground`
  (6) / `unknown` (no signal for 6+ hours, or an unrecognized/reserved
  code). "Dry-docked" still isn't a real AIS code — it's just the `unknown`
  bucket, as originally noted.
- **CW write target — fields confirmed by the user, superseding the
  live-inspection guess.** The guess (from inspecting a real "Vessel" site)
  was that `addressLine1` holds the friendly status text. **Wrong** — the
  user's actual spec: the **site NAME** holds the friendly status +
  place/destination text (e.g. *"Vessel docked in La Ciotat, France"* /
  *"Vessel underway to Barcelona, Spain (ETA: 11 Aug 21:15 UTC+1)"*), and
  **`addressLine1` holds raw decimal coordinates** (`"47.76571188325204,
  -4.965676791492198"`) so ConnectWise's own address-search/Google-Maps
  lookup locates the vessel directly. Renaming the site to "Vessel docked
  in..." still satisfies the `startsWith("vessel")` prefix match used
  everywhere else, so this doesn't break site resolution. Formatting logic
  (pure, I/O-free, matching `priority.ts`/`siteResolution.ts`'s style):
  `components/api/src/vessels/siteWriter.ts`. Stale/no-data vessels are a
  deliberate no-op, not an overwrite (tolerates AIS gaps, per the original
  design intent). ETA is shown in UTC, not the destination's local offset
  (`"UTC+1"` in the user's example) — that would need a destination-name →
  timezone lookup this doesn't have; flagged to the user as a known
  simplification, not silently done. Write step:
  `writeVesselSites()` in `routes/tracking.ts`, called from
  `jobs/tierRefresh.ts` after `applySplit`, diffed against
  `tracking.lastSiteWrite` so an unchanged status doesn't re-PATCH every
  cycle.
- **IMO↔MMSI mapping: already resolved earlier (§3.7) — MMSI is a CW company
  custom field** (`INIT-0014`), not something built from `ShipStaticData`.
  This session's `ShipStaticData` handling captures destination/ETA only,
  not identity mapping (aisstream can't fill MMSI from IMO anyway — see §3.7).
- **Which CW company status scopes the client set:** superseded by the
  Tracking Config UI (`INIT-0015`) — Company Status is one of the
  interactively-configurable rule criteria, not a fixed env value.
- **API-key strategy:** unchanged guidance (single key is fine at current
  scale; a second key would be for isolation, not capacity, if ad-hoc
  lookups are added later) — not revisited this session, still just
  guidance.

### Resolved 2026-08-11 (later same day) — every field name confirmed correct

**Field shapes are no longer a guess.** Cross-checked against three
independent authoritative sources: aisstream's docs page's literal JSON
example, their auto-generated OpenAPI models
(`github.com/aisstream/ais-message-models`, `typescript/aisStream/models/*.ts`
`baseName` entries — the real wire-format field names, since these are
generated straight from their backend's schema), and a complete working Go
reference implementation (`github.com/aisstream/example`,
`golang/main.go`, using the same shared model package). All three agree on
every field this code uses: `APIKey`, `BoundingBoxes` (`[[lat,lon],[lat,lon]]`
order — confirmed by the Go example; a separate, incomplete/broken example
in the same repo's `typescript/client.ts` uses `[lon,lat]` and `Apikey`, but
that file's message handler is literally invalid code, so it's not a
reliable reference), `FiltersShipMMSI`, `FilterMessageTypes`, `MetaData`
(their prose docs page's own JSON example already showed this casing), and
`ShipStaticDataEta`'s `Month`/`Day`/`Hour`/`Minute` (used by `aisEta.ts`) —
also confirmed exactly. **A real mid-session mistake, corrected:** a first
pass at this cross-check (against only the prose docs page) mis-read the
casing as `Metadata` and "fixed" `aisListener.ts` to match — that was
wrong; the auto-generated models and the working Go example both confirm
`MetaData` was correct all along. Reverted.

**CONFIRMED 2026-08-11 — a known, ongoing, service-wide aisstream.io outage,
not a CAST issue.** `github.com/aisstream/issues/issues/257` ("Zero messages
on global bounding box since 2026-08-05 13:31 UTC") has ~15 completely
independent developers (different accounts, regions, continents, client
languages, even keys generated *after* the outage began) all reporting the
identical symptom, all pinned to the same start time (2026-08-05 13:31 UTC,
matching to the minute across reporters). Their own control test matches
ours exactly: an intentionally invalid key is closed immediately (auth still
works), a valid key stays connected and silent (data delivery specifically
is broken). Related threads: #259, #261, #269. **Action: none on CAST's
side** — the full pipeline (listener, position cache, nav-status/nearest-
port formatting, CW write-back) is built, deployed, and correctly waiting
for real data; nothing to fix until aisstream resolves this. Re-check
`vessel_positions` / System Health's AIS Tier 1/2 msg-per-minute once that
issue closes — if messages are still zero after aisstream confirms a fix, a
protocol issue would be a live enough possibility to reopen debugging (but
every angle triple-checked this session — request format, both coordinate
orders, both key casings, with/without every optional field, even omitting
the documented-required `BoundingBoxes` entirely, two client libraries, two
keys — makes that unlikely).
