# ADR 0005 — CAST web app stack: TypeScript monorepo + SvelteKit

**Status:** Superseded by 0006 · 2026-07-19 → 2026-07-20
> Superseded before any real dependency: the framework choice (SvelteKit) was
> made without checking the org's existing stack. The org already standardizes
> on Vite + React SPA + a separate Node backend (SOC, Limnode). ADR-0006 keeps
> this ADR's still-valid parts (TypeScript monorepo, shared config-schema
> package) and corrects the framework. See `0006-web-app-stack-vite-react-express.md`.
**Related:** `../architecture/cast-web-app-mockup.md`, `../architecture/cast-web-app-vm-provisioning.md`, `0004-monorepo-with-artifacts-only-public-surface.md`, `INIT-0008`, `INIT-0002`, `INIT-0012`

## Context
The CAST web app (`INIT-0008`) needs a stack chosen before scaffolding. Forces:

1. **A config schema is shared between the web app (author) and the browser
   extension (consumer)** — the stated reason CAST is one monorepo
   (`0004-*`). Same-language schema/validation shared as a workspace package
   is a decisive advantage over cross-language duplication.
2. **The repo already commits to TypeScript** — `tsconfig.base.json` at root
   (strict, ES2022, bundler resolution) and a workspace/Turbo-shaped
   `.gitignore` (`node_modules/`, `dist/`, `.turbo/`). The extension is a
   Chrome/Edge extension — JS/TS by nature.
3. **The app is a small internal tool** on a 2 vCPU / 4 GB VM
   (`cast-web-app-vm-provisioning.md`): a handful of authenticated pages
   (config UI, fleet, vessel tracking), server-side AD/LDAPS bind + local
   fallback, and later scheduled data-sync jobs (`INIT-0002`/`INIT-0012`).
4. **Small team, AI-co-developed** — favor a boring, cohesive, low-ceremony
   stack over maximal ecosystem surface.

## Decision
1. **TypeScript across the whole monorepo**, using npm workspaces. Force 2
   makes this the path of least resistance; force 1 makes a shared TS schema
   package the point.
2. **Shared config schema lives in `packages/config-schema/`** — a Zod-based
   package imported by both the web app and (eventually) the extension, so the
   authoring side and consuming side validate against one definition. This is
   the concrete mechanism behind "developed in lockstep / shared schema."
3. **The web app is a SvelteKit app** (`components/web-app/`), using
   `@sveltejs/adapter-node` so it builds to a plain Node server that packages
   cleanly into a Docker image (the `INIT-0008` deploy target). SvelteKit
   gives SSR pages, server routes for the AD bind/API, and form actions
   well-suited to the login flow — in one lightweight framework appropriate
   to a 4 GB host.

## Consequences
- (+) One language, one toolchain across extension, web app, shared schema —
  atomic cross-component changes, shared types, no serialization drift on the
  config contract.
- (+) SvelteKit's Node adapter → small, simple Docker image; light runtime
  footprint fits the VM.
- (+) Server-side-only secrets (AD bind creds, session secret, marine-API key)
  live in SvelteKit server modules / env, never shipped to the browser —
  consistent with CAST's "no credentials client-side" law (`0002-*`).
- (−) SvelteKit/Svelte has a smaller talent pool than React/Next.js — a real
  consideration if the app is later handed to a React-familiar maintainer.
  Mitigated by: the app is small, and the framework choice is cheap to revisit
  before deep build (the auth/schema/Docker foundation is largely
  framework-agnostic).
- (−) Introduces workspace/monorepo tooling (npm workspaces now, Turbo
  optional later) — modest one-time setup, already anticipated by the repo's
  `.gitignore`.

## Alternatives considered
- **React + Next.js** — the ubiquitous default; larger talent pool. Not
  chosen: heavier than this internal tool needs on a 4 GB VM, and the
  ubiquity benefit is marginal for a small internally-maintained app. Held as
  the obvious fallback if a React-shaped maintenance reality emerges — hence
  the deliberately framework-light foundation.
- **.NET / ASP.NET Core** — best-in-class native AD integration and a natural
  fit for a Windows/AD shop. Not chosen: cross-language with the TS extension
  breaks the single-language shared-schema advantage (force 1), which
  outweighs the AD-integration edge given LDAPS bind is straightforward from
  Node.
- **Python (FastAPI/Django)** — strong for the data-sync jobs and LDAP. Not
  chosen for the web app for the same cross-language reason; may still be
  reconsidered *specifically* for the standalone scheduled data-sync services
  if they don't share the web app's process, but default is to keep them TS
  too for cohesion.
