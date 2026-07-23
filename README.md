# CAST

**C**onnectWise **A**ugmentation **S**uite for **T**riton

> **Customize and extend ConnectWise so that it allows for greater functionality for Triton than is natively provided.**

CAST is an internal Triton Technical toolset that extends and customizes the appearance, behavior, and capabilities of the ConnectWise platform — initially PSA, with other ConnectWise products likely to follow — to better align it with Triton's own workflows. It combines a browser extension that reshapes the ConnectWise UI per role/department with scheduled backend jobs that pull external data and push it into the ConnectWise instance via API.

## Status

Pre-code. Governance & knowledge canon established for CAST (this repo, private, not yet created on GitHub). The browser extension component completed its design/decision phase (see `knowledge/architecture/browser-extension.md`); the CAST web app has a hosting target (internal Linux VM, Docker, `cast.tritontechnical.com` — see `INIT-0008`) but no design yet. No application code has landed anywhere.

## How this repo is developed

AI-co-developed against a **containerized knowledge base** — a thin router (`CLAUDE.md`) plus many small, on-demand docs. The goal is to keep always-loaded AI context minimal while never losing rigor.

| Path | What |
|---|---|
| `CLAUDE.md` | Router: vision, partnership contract, knowledge index |
| `knowledge/conventions/` | How we work: versioning, changelog, naming, docs & code standards |
| `knowledge/architecture/` | The big-picture design |
| `knowledge/decisions/` | ADRs — *why* each foundational choice was made |
| `knowledge/templates/` | Fill-in scaffolds for ADRs, changelog entries, releases, initiatives |
| `Initiatives-Open.md` / `Initiatives-Complete.md` | Idea backlog & shipped history |
| `CHANGELOG.md` | Every publish, categorized |

## Components

One private monorepo — see `knowledge/decisions/0004-monorepo-with-artifacts-only-public-surface.md` for why, given the extension and its config app must always be developed together.

- **CAST browser extension** — Chrome + Edge extension standardizing ConnectWise PSA's UI per role/department (Firefox and Shift deferred — `INIT-0010`/`INIT-0011`). Source: `components/browser-extension/`. Only CI-generated build artifacts (never source) reach a public, unlisted host, to satisfy the browsers' auto-update mechanism — `INIT-0001`. Design record: `knowledge/architecture/browser-extension.md`; telemetry/identity design: `knowledge/architecture/extension-telemetry-and-identity.md`.
- **CAST web app** — centralized, web-based configuration UI for the extension above, developed in lockstep with it. Hosted internally via Docker on a Linux VM at `cast.tritontechnical.com`. Not yet designed — `INIT-0008`.
- **Scheduled data-sync services** — not yet designed. Will gather external data on a schedule and push it into the ConnectWise instance via its credentialed API. See `INIT-0002`.
