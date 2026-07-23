---
status: active
read-when: Writing a changelog entry, or cutting a release / generating Release Notes.
related: [versioning.md, docs-and-staleness.md, ../templates/changelog-entry.md, ../templates/release-notes.md]
updated: 2026-07-18
---

# Changelog & releases

## The changelog is updated EVERY publish — no exceptions

`CHANGELOG.md` is the continuous technical source of truth. Each published build adds an entry.

**Entry header:** `## vMAJOR.MINOR.PATCH.CORRECTION — build YYMM### — <ISO-8601 UTC>`

**Grouped by change type, each line tagged with a category:**

```markdown
## v0.6.0.0 — build 2607002 — 2026-07-14T09:12:00Z
### Added
- [UX] <a user-visible capability>
- [Integrations] <a new integration, read-only>
### Fixed
- [Backend] <a defect corrected>
```

- **Change types:** Added · Changed · Fixed · Removed · Deprecated · Security.
- **Categories:** a fixed, closed set — keep it consistent. Default set: `UX · Frontend · Backend · Database · API · Integrations · Design-System · Docs · Security · Performance · Infra`. Add/remove categories deliberately, not ad hoc.

## Two release tiers

| Tier | Trigger | Output |
|---|---|---|
| **General Release** | MAJOR or MINOR bump | Changelog entry **+ Release Notes** (see below) **+ docs/knowledge staleness audit** (`docs-and-staleness.md`) |
| **Maintenance Release** | PATCH or CORRECTION bump | Changelog entry only (rolls up into the next General Release's notes) |

## Release Notes (user-facing)

At every **General Release**, Claude generates curated, friendly Release Notes by **aggregating every changelog entry since the previous General Release** (all interim features, patches, corrections). The technical changelog is the source; Release Notes are the human story distilled from it. Template: `../templates/release-notes.md`.

## Release confirmation

Claude **proposes** the version bump + assembles the changelog/notes, and the **user approves** before publish. MAJOR bumps are always the user's call. Run the release checklist: `../templates/release-checklist.md`.
