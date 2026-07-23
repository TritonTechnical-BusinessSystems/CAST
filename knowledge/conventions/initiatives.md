---
status: active
read-when: Capturing, fleshing out, or completing an initiative.
related: [partnership-contract.md, ../templates/initiative.md]
updated: 2026-07-18
---

# Initiatives system

A durable backlog so **no idea is forgotten**. Two files at repo root:
- `Initiatives-Open.md` — intended/possible, not yet shipped.
- `Initiatives-Complete.md` — shipped, with the record of what & how.

## What gets captured
- Anything the **user** says they are thinking about or planning.
- Anything **Claude** suggests that the user does **not explicitly decline**.

(If the user explicitly says no, it is not captured. Everything else is.)

## Lifecycle

```
Captured ──► Fleshing-out ──► (implemented) ──► moved to Initiatives-Complete
```

1. **Captured** — logged to `Initiatives-Open.md` with a new stable `INIT-NNNN` id (never reused), source, date, vision fit, and the idea.
2. **Fleshing-out** — as the idea is detailed (before implementation), **update the entry** to record the evolving design, decisions, and links.
3. **Implemented** — **move** the entry to `Initiatives-Complete.md`, adding: version + build + date shipped, what was built, and how we got there (links to changelog entry / ADRs / knowledge files).

## Review discipline
**Before starting any new idea or process, read `Initiatives-Open.md`.** Develop with the known future in mind — leave extension points for what's coming, even if we're not building it yet. Don't paint into corners.

## Status values
`Captured` · `Fleshing-out` · `Deferred` (kept, not now) · (then removed from Open when moved to Complete).

Template: `../templates/initiative.md`.
