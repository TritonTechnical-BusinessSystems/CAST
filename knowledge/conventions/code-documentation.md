---
status: active
read-when: Writing or reviewing code.
related: [knowledge-writing-standard.md, naming-lexicon.md, docs-and-staleness.md]
updated: 2026-07-18
---

# Code documentation standard

Document for **clarity, not volume**. Code should make clear *what is happening and why* — without noise. Well-documented, not over-documented.

## Do
- Explain **purpose and intent** (the "why"), plus non-obvious decisions, domain rules, edge cases, and tradeoffs.
- Document **public interfaces** (exported functions, types, modules): what they're for, their inputs/outputs and invariants.
- Comment **complex or surprising logic**, and anything encoding a domain rule.
- Use **canonical terms/keys** from `naming-lexicon.md` in names and comments.
- Keep comments **current** — update them in the *same* change as the code (self-healing; see `docs-and-staleness.md`). A stale comment is worse than none.

## Don't
- Restate the obvious (`i++ // increment i`).
- Leave commented-out code or vague/abandoned TODOs.
- Narrate every line; let clear names and structure carry the easy parts.
