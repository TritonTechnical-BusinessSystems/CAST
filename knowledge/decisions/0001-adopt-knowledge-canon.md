# ADR 0001 — Adopt the containerized knowledge canon

**Status:** Accepted · 2026-07-18
**Related:** `knowledge/conventions/knowledge-writing-standard.md`

## Context
This project is co-developed with an AI agent. Loading all project knowledge into context every session is expensive and dilutes focus; letting docs live only in people's heads guarantees staleness. We need a structure that keeps always-loaded context minimal while making deep knowledge reliably retrievable and self-healing.

## Decision
Adopt a **router + containerized knowledge base**: a thin `CLAUDE.md` that holds only the vision, the guiding heuristic, the partnership contract, always-on essentials, and an index; all other knowledge lives in many small single-topic files under `knowledge/`, each with `read-when` frontmatter, read on demand. Foundational decisions are recorded as append-only ADRs. Ideas are captured in an Initiatives backlog. Docs are updated in the same change that makes them inaccurate.

## Consequences
- (+) Minimal always-on context; the AI routes to only what a task needs.
- (+) Decisions and ideas are durable and never silently lost.
- (+) Documentation self-heals, so it stays trustworthy.
- (−) Requires discipline: every change must maintain its docs, and every new knowledge file must be indexed.

## Alternatives considered
- **One large CLAUDE.md / monolithic docs** — simple, but grows unbounded and loads irrelevant content every session.
- **No formal canon (tribal knowledge)** — zero overhead, but rots immediately and doesn't survive context resets.
