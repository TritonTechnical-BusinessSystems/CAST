---
status: active
read-when: Designing or building Vessel Location Updating (INIT-0012) — the AIS data source, the IMO→position pipeline, the Tier 1/Tier 2 priority split, or the ConnectWise status/location write-back.
related: [cast-web-app-mockup.md, cast-web-app-vm-provisioning.md, ../decisions/0002-extension-never-touches-cw-credentials.md, ../conventions/naming-lexicon.md]
updated: 2026-08-18
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
  the encrypted `secrets` store (2026-08-20 — moved off `.env`, editable in-app
  on the Integrations page, same pattern as ConnectWise's per-instance
  credentials): `components/api/src/integrations/simpleCreds.ts`
  (`resolveSimpleCreds`/`saveSimpleCreds`), slot name and default WS URL in
  `vessels/aisListener.ts` (`AISSTREAM_SLOT`, `AISSTREAM_DEFAULT_WS_URL`,
  `aisstreamConfigured()`). Saving a key calls `startAisListener()` directly,
  so it takes effect immediately — no redeploy needed. **Never** in the SPA,
  in `knowledge/`, or in `.env.example`.
- Get/rotate a key at <https://aisstream.io> (free, GitHub sign-in); enter the
  new key on the Integrations page. The WS URL is host-allowlisted
  (`assertValidAisstreamUrl`, must be an `aisstream.io` host over `wss://`) —
  the same SSRF/credential-exfiltration protection ConnectWise's `baseUrl`
  field has.
- Docs: <https://aisstream.io/documentation>.

## 2. API model (verified from the docs, 2026-07-22)

- **WebSocket stream, NOT REST.** Connect to `wss://stream.aisstream.io/v0/stream`
  by default (overridable per the credentials section above). A **subscription message must be sent within 3 s** of
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

## 5. Resolved 2026-08-17 — the outage ended, and it was hiding a real CAST bug

The prediction the previous section closed on ("if messages are still zero
after aisstream confirms a fix, a protocol issue would be a live enough
possibility to reopen debugging") is exactly what happened. **aisstream's
outage was real, and CAST had an independent defect that would have produced
the identical symptom on its own.** Both were true at once, which is why the
first was such a convincing explanation for the second.

**aisstream sends its JSON as BINARY WebSocket frames, not text frames.**
Node's native `WebSocket` hands a binary frame back as a **`Blob`**, so
`aisListener.ts`'s `JSON.parse(String(ev.data))` was parsing the literal
string `"[object Blob]"` on every single message — throwing, and hitting the
`catch { return }` before anything was recorded. **Not a field-name or
protocol-format problem at all** (§4's field-name cross-check was and remains
correct); a frame-encoding one, a layer below where all the previous
debugging looked.

**Why it stayed invisible for six days — the diagnostic was the bug's
accomplice.** `onMessage` incremented its message counters *after* the
`JSON.parse`, so an unreadable feed and a dead feed rendered byte-for-byte
identically: `0 msg/min, connected=true`. (The `v0.8.1` changelog's claim
that "the message-count gauges increment before field parsing" was true of
*field* parsing and false of *JSON* parsing — the distinction that mattered.)
Compounding it: the listener was written **2026-08-11, six days after the
outage began**, so it never once ran against a working feed. There was no
"it used to work" signal to contradict the outage explanation.

**Proof it never worked**, gathered before any code changed: `vessel_positions`
had **0 rows, ever**, on the production host — while `checkins` had 5, ruling
out the database. And a probe with the production key run *from inside the
`cast-api` container* returned real `PositionReport`/`ShipStaticData` frames
whose `ev.data.constructor.name` was `Blob` — same result under the
container's Node 22 as under Node 24, so this was never a version artifact.

**Fix** (`components/api/src/vessels/aisListener.ts`):
1. `ws.binaryType = "arraybuffer"` on every connection, then an explicit
   `TextDecoder` decode (text frames still accepted if the server ever sends
   one). ArrayBuffer over Blob deliberately: `Blob.text()` is async and would
   have forced `onMessage` to become async, changing the ordering guarantees
   of the processing-time gauge for no benefit.
2. **Frame counters moved *before* the parse.** The gauge now means "a frame
   landed", not "a frame parsed" — the distinction that cost six days.
3. New **`parseFailuresTotal`** on `ConnState`, surfaced in the 60s summary
   line as `badFrames=`, with a rate-limited warn (first failure, then every
   100th). *Live feed we can't read* is now a distinct, visible state rather
   than one indistinguishable from an outage. **This is the durable lesson:
   a health gauge that only increments on the success path can't report the
   failure it's there to catch.**

**Verified end to end before shipping** — the real module (not a replica) run
against the live feed in an isolated data dir with the production key and the
real 50 Tier 1 MMSIs: **5 frames, 0 parse failures, 5 positions stored** with
real coordinates and `navStatus=5` (moored). Fleet transmission is
intermittent by nature (~5 of 50 vessels in a ~2-minute window) — moored
yachts transmit every few minutes, exactly as §3.3's shore-biased-coverage
note predicts. **Do not read a low msg/min as a fault**; read `badFrames` and
`vessel_positions` row count instead.

**Voyage-only rows are expected.** A `ShipStaticData`-only vessel creates a
`vessel_positions` row via `upsertVoyage` with null lat/lon. `formatSiteUpdate`
already returns null on those (and on the `unknown` bucket), so they cannot
produce a CW write — checked, not assumed.

## 6. Resolved 2026-08-17 (same day) — position history + the real Vessel Location UI (`INIT-0033`)

With the frame-decode fix landing and real data finally flowing, `INIT-0033`'s
storage/capture side was built the same day: a new insert-only
`vessel_position_history` table (`components/api/src/store/db.ts`), written
alongside every existing `vessel_positions` upsert
(`positionStore.ts`'s `upsertPosition`/`upsertVoyage`) — one row per real
update received, not a synthetic periodic snapshot (the fleet's actual
observed delivery rate is sparse enough that this stays cheap indefinitely,
per `INIT-0033`'s storage estimate).

**The Vessel Location tab (`pages/Vessel.tsx`) is now real**, replacing the
fully illustrative stub table it showed since scaffolding: a collapsible tree
(new `Disclosure` primitive), one row per vessel with a Monitoring Tier
assignment (Tier 1/2 — a Tracked Vessel with neither gets zero AIS coverage
under the priority engine, so it's excluded here rather than padding the list
with permanently-empty rows), alphabetical by vessel name. Each row's current
status is produced by the SAME `formatSiteUpdate()` the real ConnectWise
write path uses (`GET /api/vessels/tracked`), so the page can never drift
from what a real write would produce. Expanding a vessel lazily fetches
`GET /api/vessels/history/:mmsi?limit=N` (default 20, selectable 10/20/50/100)
— raw per-entry facts (position: lat/lon/nav code/speed; voyage:
destination/ETA), not reformatted through `formatSiteUpdate`, so a person can
see exactly what arrived.

**Real bug found and fixed via browser testing before shipping:** history was
first sorted by insertion order (`id`), reasoned as robust against clock
skew — but a position row's timestamp is the AIS station's own self-reported
time, while a voyage row's is CAST's own receipt time, two clocks with no
shared ordering guarantee. Seeded fixture data reproduced a visibly
out-of-order row (a voyage entry above a more recent position entry) the
first time the page was actually opened in a browser. Fixed to sort by the
displayed `recorded_at` column instead, `id` only as a tiebreak — what's
shown top-to-bottom is what determines the order a person reads it in.

## 7. Resolved 2026-08-18 — confidence-tiered CW write + Time Zone + the Vessel Location "will write" preview

The single flat 6-hour staleness clock proposed in §"Proposed 2026-08-17" (now
superseded) was replaced with a real, shipped design — decided directly with
the user, colors specified by them, thresholds proposed by CAST and
confirmed. Full rationale for *why* per-bucket persistence beats a flat
timeout is unchanged from that proposal; this section records what actually
shipped, which differs in specifics (a third "still show it, just distrust
it" tier the original proposal didn't have).

**Three confidence tiers, not two** (`components/api/src/vessels/confidence.ts`):
- 🟢 **current** — ≤2h old (`FRESH_WINDOW_MS`).
- 🔵 **presumed** — older, but a reasoned-safe guess: a **stationary** vessel
  (docked/anchored — NOT aground, see below) persists indefinitely; an
  **underway** vessel with a stated destination + ETA persists through
  ETA + 48h (`ETA_GRACE_MS`).
- 🟠 **stale** — no reasoning basis left, but still a real last-known fact —
  shown with distrust rather than gone silent. Applies to underway-with-no-
  destination, aground, and any unrecognized/reserved nav-status code, as
  soon as they're not fresh.
- Past `vesselStatusFallbackDays()` (default 90, runtime-adjustable,
  `config.ts` — the user asked CAST to pick the number directly) with
  nothing fresher at all, confidence in ANYTHING runs out — the name reverts
  to a bare, unstatused **"Vessel"**, and `addressLine1`/`timeZoneSetupId`
  are omitted from the write entirely (left untouched, not cleared) rather
  than keep asserting a position/zone with zero confidence behind it.

**Aground is deliberately NOT stationary** (user, 2026-08-17, asked directly
what "aground" means first): it's AIS nav-status code 6, set manually by the
crew's transponder — an incident, not a resting state. Groundings typically
resolve in hours to days, so letting it persist silently for weeks the way a
genuine shipyard stay does would be actively misleading almost always. It
gets the same short-fresh-then-stale tiering as underway-with-no-destination.
Proactive alerting on a real grounding (rather than a passive color change)
belongs to `INIT-0017` (Geo Alerts), not this scheme — not built.

**Site name text now emoji-prefixed** — "🟢 Vessel docked in Napoli, Italy" /
"🔵 Vessel underway to Sundneset (ETA: 17 Aug 23:00 UTC)". `siteWriter.ts`'s
`formatSiteUpdate()` now always returns *something* once any update has ever
been received (previously: null/no-op once stale) — the "always write, never
freeze silently" principle from the original proposal, realized.

**Coordinates: native feed precision, no rounding, no space** — decided
2026-08-17 (user: "we'll allow what the feed gives... I don't want to force
it"). `addressLine1` is `${lat},${lon}` via plain JS number-to-string, not
`.toFixed(N)` — different AIS sources have different natural precision, and
forcing a fixed decimal count would sometimes pad zeros that were never
really there.

**"Last AIS Data Update" — a new custom field, replacing an earlier "Site
Notes" plan mid-design** (user created it live, 2026-08-17: *"I want to use
a new 'Last AIS Data Update' custom field instead... For the date
updated... not the status."*). A plain `Text`-type custom field on the
**Site** (not the Company — verified live, id 73, `podId: "company_site"`),
written the same GET-splice-PATCH way IMO/MMSI already are on companies.
Caption configurable (`config.cwLastAisUpdateFieldCaption`, default
`"Last AIS Data Update"`), matching the existing IMO/MMSI caption pattern.
Written in **every** tier including "expired" — the whole point of the field
is showing exactly how stale things are, even once the name itself has
reverted to a bare "Vessel".

**Time Zone — a real, writable reference field, resolved from coordinates.**
Verified live (read-only) against a real Vessel site: `timeZone` is
`{id, name}`, referencing `/system/timeZoneSetups` — a fixed, 94-entry list
with **Windows-era city labels** ("GMT-5/Eastern Time: US & Canada",
"GMT+1/Amsterdam, Berlin, Bern"), NOT IANA names. This is a *different*
endpoint from `/system/timeZones` (Windows "Standard Time" names with their
own offset/DST fields) — an early check against the wrong one, corrected
same session. CW's list exposes no offset/DST data of its own, so matching
can't be a name lookup:
- `components/api/src/vessels/timezone.ts` hand-maps each of the 94 entries
  to one representative real IANA zone **plus approximate coordinates**
  (built from the live list, 2026-08-17).
- At request time: `tz-lookup` (npm, ~150KB, no deps, covers the whole globe
  including open ocean via longitude-banded nautical zones) resolves the
  vessel's coordinates to an IANA zone. Each candidate CW entry's CURRENT
  real UTC offset is computed live via `Intl.DateTimeFormat` — correct for
  today's actual DST state, so a label 20+ years stale (e.g. entry 46 groups
  Minsk with Kyiv/Sofia at "GMT+2", though Minsk has been a fixed +3 for
  years) still resolves correctly, since the label text is never trusted.
- Ranked by **(offset difference, then geographic distance)** — the distance
  tiebreak matters because many entries share a current offset (six separate
  GMT+1 European entries alone). **Real bug found live-testing against real
  production position data before shipping:** a Greek vessel at 37.98°N
  resolved to entry 39 ("Amman") over entry 40 ("Athens, Bucharest,
  Istanbul") purely because 39 came first in the array — both currently sit
  at +3 (Jordan dropped DST in 2022, landing it on the same real offset as
  Greece's summer EEST) — but Athens is the obviously correct match. Fixed
  by adding geographic distance as an explicit tiebreak among offset ties.
- **Priority 1: always coordinates.** **Priority 2 (rare — only if the
  coordinate lookup itself throws): the vessel's resolved CURRENT place's
  country**, via a small hand-built country→IANA table. Deliberately never
  falls back to `destination` (user, asked directly: *"not destination, of
  course"*) — that's where the vessel is headed, not where it is, and would
  assign the wrong zone for anything still underway.
- Omitted from the write (left untouched) whenever `addressLine1` is, for
  the same "no current confidence, don't assert a stale one" reason.

**Flag-country (MMSI → country of registration) — considered, explicitly
NOT built.** The user asked directly, then reconsidered before any code was
written: auto-writing it into the Site's Country field would sit alongside
fields that all represent *current location* (addressLine1, Time Zone) while
flag state is a *vessel* property, not a location one — "that could get
confusing... whereas everything else in the Site does [represent current
location]." Decided to record flag state elsewhere in CW manually if wanted,
not via CAST. If revisited: AIS itself never transmits flag state as a
field — it would have to be derived from the MMSI's first 3 digits (the
ITU-allocated "MID"), a lookup CAST doesn't have.

**The AIS feed carries substantially more than CAST parses today** — worth
knowing before assuming a data gap needs a new data *source* rather than
just reading more of the one already flowing. `PositionReport`/
`StandardClassBPositionReport`/`ExtendedClassBPositionReport` also carry
`TrueHeading` (bow direction, distinct from `Cog`/course-over-ground),
`RateOfTurn`, `PositionAccuracy`/`Raim` (GPS quality flags), and the
message's own onboard `Timestamp` — all currently discarded. `ShipStaticData`
also carries `ImoNumber` (broadcast directly by the ship — feeds `INIT-0014`
reconciliation for free, for any vessel whose transponder has it
programmed), `CallSign`, `Name`, `Type` (ship-type code), `Dimension`
(A/B/C/D — computable length-overall/beam), `FixType`, and
`MaximumStaticDraught` — also all discarded today. **One real caveat:**
`ImoNumber` is a **Class A-only** field in the AIS spec — Class B's own
static-data message (`StaticDataReport`, not currently subscribed to at
all) has no IMO slot whatsoever, only name/type/dimension/call sign. Smaller
yachts commonly run Class B, so IMO-via-AIS availability depends entirely on
which class a given vessel's transponder is. Not built; captured here in
case `INIT-0014` or a future initiative wants to pull on this thread.

**Vessel Location tab is now a real preview of the write, not just a
description of it** (`components/web/src/pages/Vessel.tsx`) — restructured
into three zones per vessel: a clickable header (name, Tier badge, status
badge), an always-visible-when-collapsed "Will write: …" line plus a
Position/Destination/ETA/Last-confirmed table (both driven by the same
`GET /api/vessels/tracked` response `formatSiteUpdate()` produces), and the
expandable history below. The write-preview table could not live inside the
`Disclosure` primitive's original single `header` slot — a `<table>` isn't
valid content inside a `<button>` — so `Disclosure` gained a second,
non-clickable `subheader` zone (`components/web/src/ui/Disclosure.tsx`) for
exactly this case: always-visible content that isn't part of the toggle.

## 8. Resolved 2026-08-18 — the write allowlist, and going live

Two follow-ups the same day the confidence-tier design shipped.

**"CW Site Name set to:" replaces "Will write:"** — more literal about what
the Vessel Location subheader line actually shows. Also: the no-position-
data-at-all case previously displayed the string "No signal received yet" as
if that were the site name text; now it shows bare "Vessel" — the same text
the "expired" confidence tier already correctly returns, so "never had data"
and "had data, now too stale to trust" render identically and honestly (this
is what the CW site name actually is or would be, not a description of why).

**A controlled-rollout allowlist gates Vessel Site writes, on top of (not
instead of) `isCwWritesEnabled()`.** User, asked directly before enabling
real writes for the first time: *"Can we gate the initial push so we control
it and can test with a few at a time?"* At the time this was written,
`isCwWritesEnabled()` was a single flag shared across every CW write CAST
makes — vessel identity reconciliation (`INIT-0014`, deliberately left
"gated pending user approval" as a *separate* decision), Logistics document
posting, ticket status updates — all human-triggered by clicking something
in their own UI, not scheduled jobs, so turning the shared flag on didn't
flood those. **Superseded 2026-08-20: the gate is now
`isCwWritesEnabledForInstance(instanceId)`, per CW instance, not one shared
flag** (user: "The toggle for CW writes should be per instance, not
global" — a single global switch meant enabling writes to test against
Sandbox also silently enabled real writes to Production). Vessel tracking
is Production-only, so every `isCwWritesEnabled()` reference below means
`isCwWritesEnabledForInstance("tritontech")` today — kept as written for
historical accuracy of the decision record, not as a description of the
current call.

- `config.ts`: `vesselSiteWriteAllowlist()` / `setVesselSiteWriteAllowlist()`
  / `isVesselSiteWriteAllowed(mmsi)` — a setting holding `"all"` or an array
  of MMSIs. **Default (unset) is an empty array — writes to NOBODY**, the
  safe direction for a controlled rollout. `"all"` is an explicit graduation
  sentinel, so "no restriction" can never be an accidental unset value.
- `routes/tracking.ts`'s `writeVesselSites()` checks
  `isVesselSiteWriteAllowed(v.mmsi)` before computing `formatSiteUpdate` at
  all (skips the nearest-port/timezone work too, not just the CW call, for
  anyone not allowlisted) — a second, narrower gate layered on top of the
  existing `isCwWritesEnabled()` check inside `updateVesselSite` itself,
  never a replacement for it.
- **Pre-release security gate BLOCKED the first version of this and found a
  real, live gap**, not a theoretical one: `reconcileVesselSites()`'s
  auto-create path (`rule.autoCreateVesselSite`, runs on the SAME scheduled
  tier-refresh cycle as `writeVesselSites`) calls `cw.createVesselSite()` —
  also a real CW write — and it was gated only by `isCwWritesEnabled()`, not
  by the new allowlist at all. Confirmed live in production before writing
  the fix: `autoCreateVesselSite` is `true` today. Left unfixed, the very
  first tier-refresh cycle after enabling writes would have auto-created a
  new "Vessel" site on every rule-matched company lacking one — the exact
  "everything at once" outcome this whole feature exists to prevent, with
  the allowlist offering zero protection against it. Fixed: the auto-create
  branch now also requires `isVesselSiteWriteAllowed()` on the vessel's
  normalized MMSI before creating anything.
- The security review also flagged two UI gaps, both fixed before shipping:
  the two write-status GETs (`cwWritesEnabled`, the allowlist) silently
  swallowed fetch failures and left the page showing its default,
  safe-looking "writes are OFF" state — meaning a transient request failure
  could make a page whose whole purpose is showing the true write state
  confidently show the wrong one. Now surfaces an explicit "couldn't confirm
  write status — treat as unknown" banner (with a retry) instead. And
  switching the page-level selector straight to "All tracked vessels" fired
  immediately with no confirmation, unlike the equivalent action on the
  Integrations page — now uses the same confirm-modal pattern already
  established there (`pages/Integrations.tsx`'s "Enable ConnectWise writes?"
  dialog) rather than inventing a new one.
- New routes: `GET`/`PUT /api/tracking/vessel-site-write-allowlist`.
- **The Vessel Location tab is now also the control surface** — a
  page-level "Vessel Site writes" selector (Allowlist only / All tracked
  vessels) plus a per-vessel checkbox in each vessel's `subheader` zone
  (same non-clickable-button constraint as the write-preview table, same
  fix). Switching the page-level selector to "Allowlist only" resets the
  list to empty rather than restoring whatever was previously checked —
  a deliberate choice, not a bug: re-enabling a whole prior list silently on
  a mode switch is exactly the kind of surprise a rollout-control mechanism
  shouldn't produce. A `Badge` ("CW write: ON") in the always-visible header
  line shows at a glance, without expanding, which vessels are live. The
  status `Banner` reflects both gates together (`cwWritesEnabled` AND the
  allowlist state), since either one being off means nothing writes.
- Verified live in a browser: default state (writes off) shows a neutral
  preview-only banner and unchecked boxes; checking one vessel persists
  immediately (confirmed via a direct DB read, not just the UI reflecting
  its own optimistic state back); switching to "All tracked vessels" shows
  every checkbox checked and disabled; switching back to "Allowlist only"
  correctly resets to empty.
