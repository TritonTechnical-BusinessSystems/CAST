# CAST API — module rules

Express + TypeScript (run via tsx). Invariants for work here:

- **This is the only place secrets live.** AD bind creds, JWT secret, and
  future API keys come from env (`src/config.ts`) and never leave the server —
  enforces `knowledge/decisions/0002`. The SPA (`components/web`) gets data via
  `/api/*`, never secrets.
- **Auth is AD-primary, local-fallback**, JWT in an httpOnly cookie (the SOC
  pattern). Keep the local path secondary; never make it equal-weight. Reasons
  are distinguished (`ad-unreachable` vs `invalid-credentials`) so the UI can
  steer to the fallback only when AD is actually down — preserve that.
- **The extension config is validated against `@cast/config-schema`** on the
  way in (`routes/config.ts`). Never accept unvalidated config; never fork the
  schema shape.
- **Naming follows the lexicon** (`knowledge/conventions/naming-lexicon.md`):
  Vessel, IMO Number, Navigational Status, Target Location, CAST Users, Local
  Account.
- **Stubs are marked.** In-memory config, the empty local-account store, and
  the vessel-sync body are `TODO(INIT-xxxx)` — replace with real persistence
  (SOC uses better-sqlite3) and the real sync, don't quietly leave them.
