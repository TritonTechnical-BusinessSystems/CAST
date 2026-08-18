# Release Notes

User-facing story of every CAST release, curated from `CHANGELOG.md`. Newest first. Format: `knowledge/conventions/changelog-and-releases.md`.

---

# What's New in v0.11.0 — August 2026

Vessel Site updates now come with a color: how sure CAST is that what you're reading is still true.

## Highlights

- **Every Vessel Site status now says how confident CAST is.** 🟢 means current — confirmed within the last two hours. 🔵 means CAST is still confident even though it hasn't heard from the vessel recently — a docked or anchored yacht doesn't move without transmitting somewhere, so a quiet week in a shipyard shows the same status the whole time. 🟠 means the last known fact is genuinely getting old and should be double-checked, not silently trusted. After an extended period with nothing fresh at all, the status simply reverts to a bare "Vessel" rather than keep aging a guess.
- **A new field tracks exactly how current the data is.** "Last AIS Data Update" on the Vessel Site now shows the true last-confirmed time, in every case — including once the status itself has stepped back to a bare "Vessel."
- **Time zones are now set automatically.** Every Vessel Site's Time Zone field updates itself from the vessel's real position, so the record always reflects local time for wherever the vessel actually is.
- **The Vessel Location tab now shows exactly what would be sent to ConnectWise**, not just a summary of it — a "Will write" line plus the underlying position, destination, ETA, and last-confirmed data, side by side, before anything goes out.

## For the power users

- Flag/country-of-registration lookup (from the vessel's MMSI) was considered and deliberately not built — it would sit alongside fields that all represent current *location*, and a vessel's flag isn't a location. If it's wanted, it'll be recorded in ConnectWise separately.
- The AIS feed carries meaningfully more than CAST reads today — including the vessel's own broadcast IMO number, on transponders that support it. Worth a look next time vessel-identity matching (`INIT-0014`) comes up.
- A pre-release security check caught a handful of real hardening gaps — missing validation on incoming feed data, an unbounded field, a silent-failure edge case — all fixed before this shipped, no impact to any user.

---

# What's New in v0.10.0 — August 2026

Vessel Location finally shows real ships, not the sample data it's shown since day one — and the AIS pipeline underneath it turned out to have been silently broken since it was built.

## Highlights

- **Vessel Location is live.** Every vessel CAST is actively watching now shows up as a collapsible row — current status, current position in plain language ("Vessel docked in Antibes, France"), and an expandable history of everything received for it, most recent first. This is exactly the same text that would go into ConnectWise if writes were turned on, so it doubles as a preview before flipping that switch.
- **CAST now remembers what it's seen.** Every real AIS update received is kept, not just the latest one — the foundation for answering "how long was this yacht actually in refit" and "which yards does this client keep coming back to," questions the live view alone can't answer.
- **A six-day-old bug is fixed: the AIS feed was never actually being read.** aisstream.io sends its data as binary WebSocket frames; CAST was parsing them as text, so every single message failed silently since the listener was built. This looked identical to the well-documented aisstream service outage running at the same time — both were real, and the outage ending is what exposed the second problem. Confirmed fixed against live production traffic before anything shipped.

## For the power users

- ConnectWise writes remain switched off in production while the newly-fixed pipeline accumulates a track record — flip the switch in Integrations when ready.
- Vessel Location currently shows only vessels with active AIS coverage (Monitoring Tier 1/2, roughly 60 at a time) — a Tracked Vessel with no open project or ticket work gets no AIS coverage at all under the existing priority engine, so it would only ever show an empty row.
- A pre-release security check caught the new history table growing without limit on the same file as CAST's encrypted credential store — fixed before this shipped, no impact to any user.

---

# What's New in v0.9.0 — August 2026

CAST gains a new home base: a Logistics section that can generate shipping paperwork, with the ConnectWise Sandbox now fully isolated from Production.

## Highlights

- **Logistics has arrived in CAST.** A new workspace section covers the first phases of bringing the standalone shipping-prep tool natively into CAST: shared configuration (shippers, carriers, currencies, export statements, CI flags), a live list of open ConnectWise Shipping Requests, a shipment detail page, and — the headline piece — generating a Commercial Invoice or Packing List PDF and posting it straight to the ConnectWise ticket.
- **Production and Sandbox can now be used at the same time, safely.** Every Logistics feature is scoped to a specific ConnectWise instance, and CAST will refuse to touch an instance it doesn't have credentials for rather than ever guessing — so testing against Sandbox can never accidentally reach real Production data.
- **The invoice/packing-list editor is the same screen as the PDF.** Edit the shipper, consignee, pricing, and line-item details right on screen, and the PDF you export or post to ConnectWise is exactly what you see — no separate template that can drift out of sync.

## Fixes

- A delete button anywhere in the app (Configuration's companies/carriers/currencies/etc.) could silently fail to refresh its list even though the deletion actually went through — fixed.
- Confirmed a suspected AIS field-naming bug from the previous release was a false alarm and reverted the change — the original field name was correct all along.

## For the power users

- Logistics document generation hasn't been checked against real production ConnectWise yet — it's been verified end-to-end against a stand-in test server, with the real check pending live ConnectWise credentials for the Sandbox instance.
- The Assembly (drag-and-drop packing) workspace — the piece that actually fills in a shipment's boxes and pallets — is next; today's Documents tab will show "no items packed yet" until that lands.

---

# What's New in v0.8.0 — August 2026

CAST now actually watches vessels live and writes what it sees back into ConnectWise — the AIS monitor is fully working, not just the plan for one.

## Highlights

- **Live vessel tracking is real.** CAST now keeps a persistent connection open to the AIS network for every vessel in Tier 1 (real-time) and rotates through Tier 2 (periodic) to stay within the 50-vessel-per-connection limit — reconnecting automatically if the connection ever drops.
- **ConnectWise updates itself.** Each tracked vessel's site record in ConnectWise now shows its actual current status in plain language — "Vessel docked in La Ciotat, France" or "Vessel underway to Barcelona, Spain (ETA: 11 Aug 21:15 UTC)" — and its coordinates, so ConnectWise's own address search drops a pin right on the vessel's real position.
- **Nearest-port names come from a real, purpose-picked dataset.** Since the fleet is mostly superyachts that anchor at small marinas and coastal towns rather than major shipping ports, CAST uses a broad worldwide port dataset (16,000+ locations) instead of a commercial-shipping-focused one that would have missed most of them.
- **New System Health monitoring** for the AIS connection itself — is it connected, how many messages is it receiving, is anything falling behind. Answers "is this actually working" without needing to dig through server logs.

## For the power users

- One piece is still unverified: the exact shape of the AIS "destination/ETA" data hasn't been confirmed against real live traffic yet (test connections received no data during development) — worth a check once this is live and receiving real traffic.

---

# What's New in v0.7.0 — August 2026

You can now see exactly who's ranked where, not just a top-8 sample.

## Highlights

- **The full priority list, not just a preview.** Tracking Config's preview used to show 8 vessels per tier and cut off the rest. Now it shows everyone — every tracked client, numbered by rank, laid out in five columns so the whole list is scannable at a glance instead of scrolling a long single column.
- **Tracking Config now opens first.** The Vessel Tracking tabs are reordered — Tracking Config, then Vessel Identity, then Vessel Location, then Geo Alerts — and Tracking Config is what you land on now.

---

# What's New in v0.6.0 — August 2026

The AIS vessel-tracking priority engine is now formula-driven end to end — no manual pins or excludes, and the write-target setup that used to need a button click now takes care of itself.

## Highlights

- **A clear, fair pecking order for real-time tracking.** With only 50 real-time AIS slots available, CAST now ranks strictly by real business engagement: any vessel with an active ConnectWise Project always gets a slot before a vessel with only an open ticket does, and ties go to whoever's had activity most recently. A vessel with neither doesn't get tracked at all — no more guessing why one vessel got a slot over another.
- **No more manual pins or excludes.** Earlier builds let anyone pin a vessel to the front of the line or exclude one by hand; both are gone now, on the same principle — every vessel's tracking priority comes from the same formula, for everyone. If a vessel genuinely shouldn't be tracked, remove its MMSI in ConnectWise.
- **Write-target setup is now automatic.** CAST used to need someone to click "Resolve vessel sites" to find each vessel's ConnectWise write target. That step is gone — it now happens quietly in the background every refresh cycle, and only for vessels that actually need it. There's also a new optional setting to have CAST create that ConnectWise record automatically for a client that doesn't have one yet, instead of leaving it untracked.
- **Tracking Config's option lists are alphabetized** — company statuses, project statuses, and ticket boards are now easy to scan instead of showing up in ConnectWise's internal order.

---

# What's New in v0.5.0 — August 2026

CAST now knows exactly where each vessel's tracking data should go — and won't lose track of it if that record gets renamed.

## Highlights

- **Automatic, rename-safe write-target detection.** Each tracked vessel's ConnectWise company gets a specific site — the one named "Vessel..." — where AIS status and location will be written. CAST detects it once and remembers it by its permanent ID, so renaming that site later never breaks the connection. If the site is ever deleted or deactivated, CAST notices and looks for a replacement automatically.
- **A vessel with no such site is skipped, not silently guessed at** — you'll see exactly how many in the Tracking Config preview, with a one-click "Resolve vessel sites" action to check for you.

---

# What's New in v0.4.0 — August 2026

The first working piece of the AIS vessel-tracking engine: deciding which vessels matter most right now.

## Highlights

- **Smart vessel prioritization for live tracking.** aisstream (our AIS data source) only allows watching 50 vessels in real time at once — with 200+ vessels tracked, CAST now automatically decides which 50 deserve that real-time slot: vessels with active work open on selected boards, plus anyone manually pinned, with underway vessels as a tiebreaker. Everyone else still gets periodic coverage, nobody drops out of tracking.
- **Tracking Config shows the real breakdown.** The config page now shows exactly which vessels land in real-time coverage vs. periodic, instead of just a flat count.

## Improvements

- Fixed a rendering bug in the shared notice-banner component that could split a longer message into disconnected, unreadable fragments — now fixed everywhere it's used, not just where it was first spotted.
- Fixed a layout bug where some config cards were stretched with large empty space to match a taller neighbor.

## For the power users

- New API: `GET/PUT /api/tracking/pins` for manually pinning or excluding specific vessels from AIS tracking (no dedicated UI yet — a natural next step).
- Closed a permission gap: editing the tracking rule only checked you were signed in, not that your role could actually edit it.
- Cleaned up a stale piece of internal documentation describing an earlier plan (overwriting a location's street address) that was replaced before it was ever built.

---

# What's New in v0.3.0 — August 2026

A fast way to clear the IMO/MMSI backlog, plus a permission gap closed along the way.

## Highlights

- **Vessel Identity Quick Entry** — a temporary page for entering missing or broken IMO/MMSI numbers across many vessels in one sitting, without opening a dialog for each one. Type into a row, hit Save (or fill several and hit "Save all"), and move on. Linked from the existing Vessel Identity tab; it'll be removed once the backlog is cleared.

## For the power users

- Closed a permission gap: writing a vessel's IMO/MMSI was only checking that you were signed in, not that your role was actually allowed to (`vessel.reconcile`) — it was relying entirely on the global ConnectWise-writes safety switch. Both are now enforced.

---

# What's New in v0.2.0 — August 2026

CAST can now watch itself and manage ConnectWise write access — from inside the app, no file edits or redeploys. This is also the first Release Notes CAST has ever published, so it covers everything since the very first build.

## Highlights

- **System Health now shows what's actually running.** A new Docker Containers card lists every piece of CAST's own infrastructure — what it is, what it's for, whether it's healthy, how long it's been up. If something's wrong with the app itself, this is where you'll see it first.
- **ConnectWise writes can be turned on and off from the Integrations page.** This safety gate used to require editing a config file on the server and redeploying. Now it's a button — one click to turn writes off, a confirmation step to turn them on (since that's the direction that matters).
- **The download landing, sign-in, and Fleet deployment tracking** — CAST's front door for getting the browser extension installed and knowing who has it.
- **Fleet** — see every team member's device/browser pairs, filter to who needs attention, and prune stale records without uninstalling anything.

## Improvements

- The rail brand and tagline read cleanly at every size; version numbers no longer show a meaningless trailing ".0".
- Tabs remember where you left them — refreshing or sharing a link keeps the same view.
- Extension identity is now a friendly machine + browser name instead of a raw device ID.
- The installer no longer gets stuck re-prompting for admin permission on hardened machines.

## Fixes

- A rare crash that could briefly take the whole site down during a deploy is fixed — tracked down to a known Node.js compatibility issue in a database library, not anything in CAST's own code.
- The API's production footprint shrank by more than half (1.14GB → 511MB) with no change in behavior — faster deploys, smaller attack surface.

## For the power users

- The safety gate for ConnectWise writes is now a live, in-app setting (`isCwWritesEnabled()`), not just an environment variable — the first working example of a pattern we'll extend to real credentials next.
- CAST's own pre-deploy design review now drives a real, isolated browser to check its work, instead of only reading source code and guessing how it'll look.
- Deploys build the two Docker images sequentially rather than in parallel, and automatically retry once if the outgoing container is still settling — both fixes for real failures caught live on the deploy host.

---
_Full technical detail: see `CHANGELOG.md` (builds 2607001 … 2608007)._
