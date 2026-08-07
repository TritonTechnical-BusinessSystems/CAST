# Release Notes

User-facing story of every CAST release, curated from `CHANGELOG.md`. Newest first. Format: `knowledge/conventions/changelog-and-releases.md`.

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
