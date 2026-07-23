# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This file is a **router**, not a library. It is loaded into context every session, so it stays small: the always-true essentials, plus an **index** of the on-demand knowledge base. Read individual `knowledge/` files only when a task needs them.

---

## What CAST is

**CAST** — **C**onnectWise **A**ugmentation **S**uite for **T**riton — is an internal Triton Technical toolset that extends and customizes the appearance, behavior, and capabilities of the ConnectWise platform — initially PSA, with other ConnectWise products likely to follow — to better align it with Triton's own workflows. It combines a browser extension that reshapes the ConnectWise UI per role/department with scheduled backend jobs that pull external data and push it into the ConnectWise instance via API.

---

## North Star — the vision that must permeate everything

> **Customize and extend ConnectWise so that it allows for greater functionality for Triton than is natively provided.**

One private monorepo, three components developed together — see `knowledge/decisions/0004-monorepo-with-artifacts-only-public-surface.md`:
- **CAST** (browser extension) — reshapes what users see and click. No ConnectWise credentials, ever. Source lives at `components/view-manager-extension/`. **Committed browser scope: Chrome + Edge** (nearly-shared Chromium build); Firefox (`INIT-0010`) and Shift (`INIT-0011`, opportunistic only) are deferred. Nothing here is ever published as source — only CI-generated build artifacts (`.crx`, update manifest, rules JSON) reach an unlisted public host, since Chrome/Edge's auto-update mechanism requires an unauthenticated-fetchable URL for those specifically, not a public repo. See `INIT-0001`.
- **CAST web app** — centralized, web-based configuration UI for the extension above, replacing its planning-phase manual "export JSON, commit to repo" workflow. Always developed in lockstep with the extension (shared config schema). Not yet designed — see `INIT-0008`.
- **Scheduled data-sync services** — reach into ConnectWise via its real, credentialed API. Not yet designed — see `INIT-0002`.

Design laws carried over from the first component's completed design phase (full detail: `knowledge/architecture/browser-extension-view-manager.md`, `knowledge/decisions/0002-*.md`):
- Never store ConnectWise API credentials or secrets in client-side or publicly-hosted code. Credentials live server-side only, encrypted.
- Prefer ConnectWise's own supported extension points (Hosted APIs, real trusted-input UI flows) over reverse-engineering internal/private protocols — the latter breaks silently on every platform upgrade.
- Standardize per role/department rather than leaving customization to individual users — consistency is the product.
- Automated actions never bypass a platform's own destructive-action confirmations, and never act on an ambiguous/unconfirmed UI target.

<!-- TODO: these design laws were drafted from the browser extension's design record. Revisit once the scheduled-sync component's own constraints are known — they may add laws of their own (e.g. data-retention, rate-limiting). -->

**Guiding heuristic (apply to every decision):** *Does this give Triton capability ConnectWise doesn't natively provide, without storing credentials insecurely or fighting the platform's own trusted-action model?*

<!-- TODO: proposed default, inferred from the security/credentials constraints emphasized throughout the extension's design record. Confirm or refine once more of the roadmap (scheduled sync, other CW products) is real. -->

---

## How we work together — Partnership Contract

Every recommendation offers, where they exist:
1. **The adjacent opportunity** — the natural "…and we could also do X."
2. **The next-level leap** — the more ambitious idea you didn't ask for and might not have considered.
3. **Truth alongside both** — risks, costs, tradeoffs stated plainly, and honest pushback when something works against the vision. **Intellectual honesty over agreeableness, always.**

Operating rules:
- **Log initiatives.** Anything the user says they're planning, or any idea I suggest that the user doesn't explicitly decline, gets recorded in `Initiatives-Open.md`. No idea is forgotten.
- **Review the future first.** Before starting any new idea/process, read `Initiatives-Open.md` and build with the known future in mind.
- **Maintain the canon.** When a change touches something documented, update it in the *same* change. See `knowledge/conventions/docs-and-staleness.md`.

Full contract: `knowledge/conventions/partnership-contract.md`.

---

## Always-on essentials

- **Versioning:** product version `MAJOR.MINOR.PATCH.CORRECTION` (MAJOR `0` until the user declares `1.0`). Build stamp `YYMM###`. Full rules: `knowledge/conventions/versioning.md`.
- **Changelog every publish**, categorized, with build + ISO-8601 UTC timestamp: `knowledge/conventions/changelog-and-releases.md`.
- **Knowledge-writing standard** (how to write/maintain these files): `knowledge/conventions/knowledge-writing-standard.md`.
- **Naming:** never hardcode user-facing strings arbitrarily; use canonical keys from the lexicon: `knowledge/conventions/naming-lexicon.md`.

---

## Knowledge index — read on demand (do NOT read all of these each session)

**Conventions / how we operate**
- [knowledge-writing-standard.md](knowledge/conventions/knowledge-writing-standard.md) — how to author & maintain knowledge files. READ WHEN: creating/editing any `knowledge/` file or `CLAUDE.md`.
- [partnership-contract.md](knowledge/conventions/partnership-contract.md) — full working-agreement & behavior rules. READ WHEN: unsure how to frame recommendations or handle suggestions.
- [versioning.md](knowledge/conventions/versioning.md) — version + build scheme, increment decision tree. READ WHEN: publishing, tagging, or deciding a bump.
- [changelog-and-releases.md](knowledge/conventions/changelog-and-releases.md) — changelog format, General vs Maintenance release, Release Notes. READ WHEN: writing a changelog entry or cutting a release.
- [docs-and-staleness.md](knowledge/conventions/docs-and-staleness.md) — per-change DoD + release staleness audit. READ WHEN: finishing a change or cutting a General Release.
- [naming-lexicon.md](knowledge/conventions/naming-lexicon.md) — ubiquitous language; canonical object names. READ WHEN: naming anything in code, DB, API, or UI.
- [initiatives.md](knowledge/conventions/initiatives.md) — how the Initiatives system works. READ WHEN: capturing, fleshing out, or completing an initiative.
- [code-documentation.md](knowledge/conventions/code-documentation.md) — code commenting standard. READ WHEN: writing or reviewing code.

**Architecture / the big picture**
- [browser-extension-view-manager.md](knowledge/architecture/browser-extension-view-manager.md) — full design/decision record for the **CAST browser extension** (role/department UI standardization, pod detection, config distribution, deployment, multi-browser scope). READ WHEN: working on that extension, or making a decision that touches it even from this repo (e.g. shared config hosting, naming).
- [extension-telemetry-and-identity.md](knowledge/architecture/extension-telemetry-and-identity.md) — the extension's update-freshness banner, device/user identity mechanism, and the CAST web app's check-in catalog. READ WHEN: touching update-staleness detection, identity reporting, or the check-in catalog.
- [cast-web-app-mockup.md](knowledge/architecture/cast-web-app-mockup.md) — the **CAST web app's** first mockup: information architecture, AD + local-account login design, visual identity. READ WHEN: working on the CAST web app's UI/IA, login screen, or Vessel Location Updating page.
- [cast-web-app-vm-provisioning.md](knowledge/architecture/cast-web-app-vm-provisioning.md) — the CAST web app's deploy host `trt-cast-01`: identity/sizing, network (static `10.20.30.231`), Tailscale access, Docker stack. READ WHEN: deploying to, accessing, or changing the network/host of the web app VM.
- [vessel-location-updating-aisstream.md](knowledge/architecture/vessel-location-updating-aisstream.md) — the AIS data source (**aisstream.io**) for Vessel Location Updating (`INIT-0012`): the WebSocket API model, where the key lives, and the design consequences (push-stream not lookup, IMO↔MMSI mapping, reverse-geocoding, nav-status mapping). READ WHEN: designing/building the vessel sync pipeline or the CW address write-back.
- [connectwise-api-integration.md](knowledge/architecture/connectwise-api-integration.md) — the **ConnectWise PSA REST API** integration pattern (auth header, base URL, custom-field read via `customFieldConditions`, write via JSON-Patch), mirroring LogisticsCoordinator's live integration. READ WHEN: building/changing CAST's credentialed CW read-write path (`INIT-0002/0012/0014`) or the `ManageCwClient`.
- [design-system.md](knowledge/architecture/design-system.md) — the **web app design system** rules (tokens-only, reusable-first, no per-feature classes, no non-dynamic inline styles) + token taxonomy + `ui/` primitive inventory. READ WHEN: writing or reviewing ANY CAST web UI (`0007`).
- [cast-web-app-deployment.md](knowledge/architecture/cast-web-app-deployment.md) — Docker/compose topology, TLS-terminating nginx, **acme-dns DNS-01 TLS** (LC's method), and the **GA-only auto-update** timer. READ WHEN: deploying CAST or changing container/nginx/TLS/update config.

**Decisions (ADRs)** — `knowledge/decisions/` — READ WHEN: revisiting *why* a foundational choice was made.

**Templates** — `knowledge/templates/` — changelog entry, release notes, ADR, release checklist, initiative.

---

## Repository map

- `CLAUDE.md` — this router.
- `Initiatives-Open.md` / `Initiatives-Complete.md` — idea backlog & history.
- `CHANGELOG.md` — every publish, categorized.
- `knowledge/` — the on-demand canon (conventions, architecture, decisions, templates).
- `components/` — this repo's own components — real source, not references. See `knowledge/decisions/0004-monorepo-with-artifacts-only-public-surface.md`.
  - `components/view-manager-extension/` — the browser extension (design complete, no code yet).
  - `components/web/` — the **CAST web app frontend** (`@cast/web`, Vite + React SPA).
  - `components/api/` — the **CAST web app backend** (`@cast/api`, Express + TypeScript, run via tsx): auth, extension config, vessel sync.
- `packages/` — shared workspace packages.
  - `packages/config-schema/` — `@cast/config-schema` (Zod), the config contract shared by the web app (author) and extension (consumer).
- Root is a **pnpm + turbo TypeScript monorepo** (`pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`), mirroring Limnode's conventions. Stack rationale: `knowledge/decisions/0006-web-app-stack-vite-react-express.md` (supersedes `0005`). Deploy: `docker-compose.yml` (nginx serving the SPA + proxying `/api` to the Express container, SOC-style).

> Status: First code has landed. Governance & knowledge canon established. The browser extension completed its design phase (`knowledge/architecture/browser-extension-view-manager.md`) but has no code yet. The **CAST web app is scaffolded** — Vite React SPA (`components/web`) + Express API (`components/api`) + shared `packages/config-schema`; working AD-LDAPS-+-local-fallback login over a JWT cookie, route protection, and the `CAST Extension` / `Vessel Location Updating` page shells (bodies are placeholders against `knowledge/architecture/cast-web-app-mockup.md`). Typechecks/builds/runtime-verified. Deploys via Docker to `trt-cast-01` (`knowledge/architecture/cast-web-app-vm-provisioning.md`; permanent hostname `cast.tritontechnical.com`). No release tagged yet — first build will be `v0.1.0.0` when the user declares it.
