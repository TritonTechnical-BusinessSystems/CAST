---
status: active
read-when: Creating or editing any knowledge/ file, or CLAUDE.md.
related: [partnership-contract.md, docs-and-staleness.md, initiatives.md]
updated: 2026-07-18
---

# Knowledge-writing standard

The knowledge base is **containerized**: many small, single-topic files, fronted by `CLAUDE.md` as a router. The goal is to **minimize always-loaded context** — the AI sees the index every session and reads only what a task needs.

## Rules

1. **One concept per file.** Cohesive and single-topic. Not so coarse it loads irrelevant content; not so fine you die by a thousand reads.
2. **Frontmatter on every file:**
   ```
   ---
   status: active            # active | proposed | superseded by NNNN
   read-when: <the trigger that makes this file relevant>
   related: [file.md, ...]
   updated: YYYY-MM-DD
   ---
   ```
   The `read-when` line is the routing logic — it lets the AI decide relevance *without reading the file*. Spend effort making it precise.
3. **Every file gets an index entry in `CLAUDE.md`** with a one-line description + a `READ WHEN:` trigger. New file → add the entry. Deleted/renamed file → fix the index.
4. **Never `@import` on-demand knowledge.** `@path` imports load eagerly every session and defeat the purpose. The index references files the AI *chooses* to read. Reserve `@import` for the rare always-needed item.
5. **Cross-link** related files by relative path (`related:` / `see also:`) so the AI can pull the thread.
6. **Keep `CLAUDE.md` a router, not a library.** The only content that lives there permanently is the distilled vision, the guiding heuristic, the partnership-contract summary, the always-on essentials, and the index. Everything else is on-demand.
7. **Decisions are ADRs.** Foundational either/or choices go in `knowledge/decisions/NNNN-*.md`, append-only. Never rewrite history — supersede (mark the old one `superseded by NNNN`).
8. **Self-healing.** A directory of small files rots exactly like manual docs. When a change makes a file inaccurate, fix it in the *same* change. See `docs-and-staleness.md`.
9. **Two-level index only if it strains.** A flat index of even ~50 entries is trivial (~1–2k tokens). Split into category sub-indexes only if it genuinely gets heavy. Don't pre-optimize.

## Module-local rules

Place a nested `CLAUDE.md` inside a package/module for rules that should auto-activate when working there (Claude Code loads a directory's `CLAUDE.md` when operating in it). Use for invariants local to that module.
