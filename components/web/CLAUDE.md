# CAST web (frontend) — module rules

Vite + React SPA. Invariants for work here:

- **No secrets, ever.** This is client code shipped to the browser. All
  privileged work happens in `components/api`; the SPA calls `/api/*` and
  relies on the httpOnly session cookie it can't read.
- **Build UI against the approved mockup** (`knowledge/architecture/cast-web-app-mockup.md`):
  same palette/tokens (`src/index.css`), same IA — one CAST Extension page with
  tabs, Vessel Location Updating as its own page.
- **Auth is AD-primary, local-fallback.** Keep the local path a secondary
  disclosure on the login screen, never an equal-weight option.
- **Naming follows the lexicon** (`knowledge/conventions/naming-lexicon.md`):
  Vessel, IMO Number, Navigational Status, Target Location, CAST Users, Local
  Account. Don't introduce synonyms in UI copy.
- **Types shared with the extension come from `@cast/config-schema`** — import
  them, don't redeclare the config shape locally.
