---
status: active
read-when: Publishing, tagging a build, or deciding which version level to increment.
related: [changelog-and-releases.md]
updated: 2026-07-18
---

# Versioning & build scheme

Two separate identifiers: a **semantic product version** and a **date-stamped build**.

## Product version — `MAJOR.MINOR.PATCH.CORRECTION`

| Segment | Meaning | Who bumps |
|---|---|---|
| **MAJOR** | `0` through initial development. The user declares `1.0` as the launch milestone, and bumps it for breaking/fundamental shifts thereafter. | **Manual — user only** |
| **MINOR** | New backward-compatible feature/capability | Claude |
| **PATCH** | Fixes a defect in existing behavior; no new feature | Claude |
| **CORRECTION** | Non-functional fix (copy, styling, docs, packaging, reverting a bad release) | Claude |

- **First build:** `v0.1.0.0`. Canonical form is four segments; a trailing `.0` correction may be dropped in casual display (`v0.1.0`), but the changelog uses the full form.
- **Increment rule:** Claude picks the **highest applicable** level each publish; bumping a level **resets every level below it to `0`**. MAJOR is never auto-bumped.
- **patch vs correction tiebreak:** *Does it change runtime behavior or fix a defect a user could hit?* → yes = PATCH, no = CORRECTION.

### Increment decision tree (per publish)
1. Breaking/fundamental change **and** the user has authorized it → MAJOR (manual).
2. Else new feature/capability → MINOR.
3. Else fixes a defect in behavior → PATCH.
4. Else (copy/style/docs/packaging/revert) → CORRECTION.

Example: `0.5.0.0` → feature → `0.6.0.0` → bug fix → `0.6.1.0` → typo → `0.6.1.1`.

## Build stamp — `YYMM###`

- A single 7-digit token: `YY` (2-digit year) + `MM` (2-digit zero-padded month) + `###` (zero-padded build sequence **within that month**, starting at `001`).
- The `###` **resets to `001` at the start of each new month**.
- Fixed width → unambiguous to parse and chronologically sortable as both string and integer (`2606001 < 2606002 < 2607001 < 2701001`).
- Capacity is 999 builds/month — ample, since a "publish" is deliberate, not per-commit.
- The day and exact time are **not** in the token; they live in the full **ISO-8601 UTC timestamp** (e.g. `2026-06-30T14:22:05Z`) recorded with every publish alongside the product version.

## A "publish" is deliberate

A publish/release is a tagged, intentional act — **not** every commit. During heavy dev you may commit many times and publish once. The build sequence and version only advance on a publish.
