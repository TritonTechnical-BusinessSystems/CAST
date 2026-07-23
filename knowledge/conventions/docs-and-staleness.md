---
status: active
read-when: Finishing a change, or cutting a General Release (MAJOR/MINOR).
related: [knowledge-writing-standard.md, changelog-and-releases.md]
updated: 2026-07-18
---

# Documentation & staleness control

Stale documentation is a defect. Docs self-heal: they are updated in the same change that makes them inaccurate, not in a follow-up.

## Two layers

### 1. Per-change Definition of Done (continuous)
If a change touches anything documented — **user documentation** or a `knowledge/` file — updating that doc is **part of the same change**, not a follow-up. This keeps the periodic audit cheap.

### 2. General Release audit (backstop, also on request)
On every MAJOR/MINOR release (or when the user asks), run a staleness pass and record the result (a dated note):

- [ ] Each `knowledge/` file: still accurate? `status:` correct (`active` / `superseded by NNNN`)?
- [ ] User documentation: features added/changed/removed reflected? Screenshots/illustrations current?
- [ ] `CLAUDE.md` index: new files listed, dead links removed, `READ WHEN:` triggers still true?
- [ ] ADRs: superseded decisions marked as such?
- [ ] `Initiatives-Open.md`: shipped items moved to `Initiatives-Complete.md`?

Anything inaccurate must be **added, updated, or removed** as appropriate — no exceptions.

## Documentation is a first-class deliverable
User-facing documentation is built and maintained **with every build**, not retrofitted.
