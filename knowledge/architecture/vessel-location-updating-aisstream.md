---
status: active
read-when: Designing or building Vessel Location Updating (INIT-0012) — the AIS data source, the IMO→position pipeline, or the ConnectWise address write-back.
related: [cast-web-app-mockup.md, cast-web-app-vm-provisioning.md, ../decisions/0002-extension-never-touches-cw-credentials.md]
updated: 2026-07-22
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

## 4. Still open (decide before building for real)

- Where the IMO↔MMSI mapping lives and how it's seeded (add an MMSI custom field
  in CW? build from `ShipStaticData`?).
- The world-ports dataset choice (World Port Index vs UN-LOCODE vs other) and how
  "nearest" is bounded (a max-distance beyond which we say "at sea", not a port).
- The exact **nav-status → friendly-label** table (which AIS codes fold into
  "Under way", and the last-seen threshold that trips the "unknown / dry-docked?"
  bucket).
- **CW write target — now that it's status + place name, NOT an address:** almost
  certainly **two custom fields** on the company ("Vessel Status", "Vessel
  Location") rather than a location record's address field. Confirm with the user
  (the original "overwrite a location's address field" plan is superseded).
- Listener topology: in-process in `@cast/api` vs. a separate worker; and the
  latest-position cache store (in-memory vs. the same persistence INIT-0008 picks,
  e.g. better-sqlite3).
- Which ConnectWise **company status** scopes the client set (the CW-side write,
  `INIT-0002`) — this *also* sets how many vessels are monitored (§3.6), so pick a
  status that keeps the active set manageable (ideally ≤50 → one subscription).
- **API-key strategy (guidance, not a hard decision):** a **second key is worth
  it for *isolation*, not capacity** — a dedicated key/connection for the
  steady-state background monitor, separate from a key used for interactive
  "check this vessel now" ad-hoc lookups, so a burst of ad-hoc requests can't
  disrupt/throttle the monitor. **Do NOT partition keys by business department
  (support vs sales)** — that's an org boundary aisstream doesn't see and it
  drifts as clients move; partition (if at all) by the 50-per-subscription
  mechanic, or avoid it via rotation.
- **Unknowns only a live test settles:** the per-user throttle ceiling, whether
  the MMSI filter is AND-ed with the box, and the vessels' real transmit interval
  (sets the rotation listening-window). The spike (§5-adjacent) answers the last.
