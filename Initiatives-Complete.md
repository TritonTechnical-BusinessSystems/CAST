# Initiatives — Complete

Initiatives that have been implemented. Each entry records **what we built and how we got there**, moved here from `Initiatives-Open.md` once shipped.

Entry format (extends the open template):
- The original initiative fields, plus:
- **Implemented in:** version `X.Y.Z.C` · build `YYMM###` · date
- **What we built:** the outcome.
- **How we got there:** key decisions, tradeoffs, and links to changelog entry / ADRs / knowledge files.

---

### INIT-0013 — In-app secret management (secure API-key entry/update)
- **Source:** User · **Added:** 2026-07-22
- **Serves:** Operating CAST without editing files on the box — a secure place in the CAST web app to enter/update integration secrets (aisstream.io, TrackingMore, ConnectWise API credentials) instead of hand-editing `components/api/.env` and redeploying.
- **Idea:** An admin-only settings surface in the web app to view (masked) and update API keys/secrets. Values stored **encrypted at rest** server-side and injected into the services that need them — never returned to the browser in plaintext, never exposed to the SPA.
- **Implemented in:** version `0.16.0.0` · build `2608034` · 2026-08-21 (completing a pattern built incrementally across three releases — see below).
- **What we built:** Every CAST integration (ConnectWise PSA per instance, aisstream.io, TrackingMore) now stores its credentials exclusively in an AES-256-GCM-encrypted `secrets` table (`store/secretStore.ts`), entered/rotated entirely from the Integrations page — no `.env` fallback for any of them anymore. Saves are partial-merge (a blank field leaves the stored value untouched); the SPA only ever receives masked values; every credential-write route is gated behind the `integrations.write` permission; "Test connection" runs a real live call (ConnectWise system-info, an aisstream WS handshake, or a TrackingMore carrier-list read) so a bad key is caught immediately, not on next real use.
- **How we got there:**
  - **v0.15.0 (2026-08-19)** built the pattern for ConnectWise first, and hardened it further than originally scoped: per the user's explicit "I'm not comfortable with a fallback at all," credential resolution became strictly per-instance with zero cross-instance or env fallback of any kind, enforced at the TypeScript level (`connectwise/creds.ts`). Production's real credentials — previously living only in `.env` — were migrated into the store via a one-off script, verified byte-for-byte before any code depending on the store went live. A pre-release security gate BLOCKED the first version and found two real gaps (an unvalidated credential-destination host enabling SSRF/exfiltration; a missing try/catch that could crash the whole API process) — both fixed and independently re-verified.
  - **v0.16.0 (2026-08-21)** generalized the same pattern to aisstream.io and TrackingMore (`integrations/simpleCreds.ts`, a shared single-account variant of the per-instance CW pattern), migrating both providers' existing `.env` values into the store the same verified-migration way. Both providers' URL fields got the same host-allowlist protection ConnectWise's `baseUrl` already had (`assertValidAisstreamUrl`/`assertValidTrackingmoreUrl`) — added proactively this time, not found by a gate, since the exact same exfiltration shape applied. Saving an aisstream key now starts the AIS listener immediately (previously a boot-time-only decision) — closing what would otherwise have been "editable in the UI" in name only.
  - **Superseded design note:** the July 2026 "precedence rule — in-app value vs. `.env` value, which wins" question this initiative originally posed was answered more strictly than planned: there is no precedence, because there is no `.env` fallback at all for any of these three integrations. `knowledge/decisions/0002-extension-never-touches-cw-credentials.md` still governs (secrets never reach the SPA or the browser extension); the *storage* mechanism envisioned here has fully replaced env-var configuration for every integration built so far.
  - Links: `CHANGELOG.md` v0.15.0/v0.16.0 entries, `knowledge/architecture/connectwise-api-integration.md`, `knowledge/architecture/vessel-location-updating-aisstream.md`, `knowledge/architecture/shipment-tracking-trackingmore.md`.
- **Related:** `INIT-0002`, `INIT-0008`, `INIT-0012`, `INIT-0018`, `INIT-0026`.
