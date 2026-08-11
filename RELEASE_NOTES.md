# Release Notes

User-facing story of every CAST release, curated from `CHANGELOG.md`. Newest first. Format: `knowledge/conventions/changelog-and-releases.md`.

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
