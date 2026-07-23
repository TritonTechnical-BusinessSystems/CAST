# ADR 0006 — CAST web app stack: Vite + React SPA + Express API (matching org conventions)

**Status:** Accepted · 2026-07-20
**Supersedes:** `0005-web-app-stack-typescript-sveltekit.md`
**Related:** `../architecture/cast-web-app-mockup.md`, `../architecture/cast-web-app-vm-provisioning.md`, `0004-monorepo-with-artifacts-only-public-surface.md`, `INIT-0008`, `INIT-0012`

## Context
ADR-0005 chose a TypeScript monorepo (correct) with **SvelteKit** (chosen in a
vacuum). It was superseded once we checked what Triton's other projects
actually use. The two existing projects both follow one pattern — and it is
**not** Next.js, which had been assumed:

- **SOC** — **Vite + React SPA** (react-router, TanStack Query, Zustand) +
  **Express** backend (JS), **JWT-in-httpOnly-cookie** auth (`bcryptjs`,
  `requireAuth`/`requireAdmin` middleware, roles), **`node-cron`** scheduled
  jobs, deployed as **nginx + docker-compose** with Let's Encrypt.
- **Limnode** — **Vite + React SPA** + **NestJS** API, in a **pnpm + turbo
  monorepo** (`apps/*` + `packages/*`, shared `packages/domain`).

Consistency across the org's projects outweighs SvelteKit's marginal
ergonomic edges. Standardization is also CAST's own stated value.

## Decision
Match the org's conventions, taking the monorepo shape from Limnode and the
runtime/auth/deploy pattern from SOC:

1. **pnpm + turbo monorepo** (`pnpm@11.9.0`, `turbo`), workspaces
   `packages/*` + `components/*`. (CAST keeps its established `components/`
   term rather than Limnode's `apps/`; same idea.) Root `tsconfig.base.json`
   already existed.
2. **Frontend `components/web`** — **Vite + React SPA** (react-router-dom),
   built to static assets. TypeScript.
3. **Backend `components/api`** — **Express + TypeScript**, run via `tsx`
   (no compile step — same "run the source" spirit as SOC's plain-node
   backend). Chosen over NestJS (Limnode) because CAST is small and Express +
   `node-cron` maps almost 1:1 onto CAST's needs (login + the vessel-sync
   scheduled job + a small datastore). *User's explicit choice.*
4. **Auth** — **JWT in an httpOnly cookie**, mirroring SOC: primary path is
   the AD LDAPS bind + CAST-Users group gate (from ADR-0005's design), with
   the local **bcrypt** account as the break-glass fallback.
5. **Shared `packages/config-schema`** (`@cast/config-schema`, Zod) — retained
   unchanged from ADR-0005; the config contract shared by the web app
   (author) and extension (consumer), analogous to Limnode's `packages/domain`.
6. **Deploy** — **nginx + docker-compose** (SOC-style): the SPA is served as
   static files by nginx, which proxies `/api` to the Express container.

## Consequences
- (+) One stack across SOC, Limnode, and CAST — shared conventions, shared
  deployment patterns, no per-project context tax, a talent pool the org
  already has.
- (+) SOC's exact primitives are reusable: JWT-cookie auth and `node-cron` are
  precisely what CAST's login and Vessel Location Updating sync (`INIT-0012`)
  need.
- (+) TypeScript monorepo + shared config-schema (the good parts of ADR-0005)
  carried forward intact.
- (−) A SPA + separate API means auth/session must be wired across the network
  boundary (cookie + `/api/auth/me`), slightly more plumbing than an
  all-in-one framework — but it's the pattern the org already runs.
- (−) Running the API via `tsx` (vs. a compiled build) transpiles at startup;
  fine for an internal service, and can be swapped for a compiled build later.

## Alternatives considered
- **SvelteKit (ADR-0005)** — superseded: introduces a second framework the org
  doesn't use, for marginal benefit.
- **Next.js** — the assumed incumbent, but neither existing project actually
  uses it; adopting it would still diverge from the real Vite-SPA convention.
- **NestJS API (Limnode-style)** — viable and more structured, but heavier
  ceremony than a small app needs; Express fits CAST better and the user chose
  it. NestJS remains the reference if CAST's API grows large.
