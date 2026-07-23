# ADR 0003 — Extension repo topology: separate public repo, reference-only local folder, schema is the real contract

**Status:** Superseded by 0004 · 2026-07-18
**Related:** `knowledge/architecture/browser-extension-view-manager.md`, `knowledge/decisions/0002-extension-never-touches-cw-credentials.md`

## Context
CAST (the browser extension) must live in its own **public** repo (force-install update mechanics require it — see `knowledge/architecture/browser-extension-view-manager.md` §7 — and it must never contain anything from the private CAST canon). At the same time:

- Developers working in this repo want the extension to be visible/navigable as a component of CAST, not just a name in a doc.
- A new **CAST web app** (centralized configuration UI, itself part of the larger CAST web app — see `INIT-0008`) needs to author the same rules/config JSON that the extension consumes at runtime (`knowledge/architecture/browser-extension-view-manager.md` §5). Two independently-repo'd codebases now need to agree on one data shape.

Git submodules and subtrees were considered for giving the extension a "real" local folder:
- **Submodule** — keeps the extension as a genuinely separate repo/history, checked out at a pinned commit. Rejected: submodule UX (detached HEAD, easy-to-forget `--init --recursive`, easy-to-commit stale pointers) is disproportionate friction for a small team, and it doesn't actually address the thing that needs to stay in sync (the config schema) — it just makes the code visible.
- **Subtree** — avoids the detached-pointer footgun but merges the extension's history/content into this repo, muddying the "the extension has its own separate repo" boundary that exists for a real reason (must be public, must never see private material).

## Decision
1. `components/view-manager-extension/` in this repo is a **reference-only folder** — docs and the shared config schema, no extension code. The extension's actual source lives solely in its own repo (to be created — `INIT-0001`); anyone developing it clones that repo directly.
2. The **rules/config schema** consumed by the extension and authored by the CAST web app is treated as an explicit, versioned contract — not something inferred from code proximity. Where exactly that schema is defined/versioned (a standalone JSON Schema file, a small published types package, etc.) is not yet decided — tracked as part of `INIT-0008`.

## Consequences
- (+) No submodule/subtree overhead for a small team; each repo's git history stays simple and independent.
- (+) Forces the actual coupling point (the config schema) to be named and versioned explicitly, rather than papered over by folder proximity.
- (+) Keeps the extension repo's public/private boundary unambiguous — nothing from CAST is ever physically inside it.
- (−) No automatic local checkout of the extension's code alongside this repo — a minor convenience cost, paid once per developer per machine.
- (−) Requires discipline to keep `components/view-manager-extension/` in sync with what the extension repo actually consumes once the schema contract is defined (same self-healing discipline as any other knowledge file — see `knowledge/conventions/docs-and-staleness.md`).

## Alternatives considered
- **Git submodule** — rejected: friction disproportionate to the value delivered (local browsability), and doesn't solve the schema-agreement problem.
- **Git subtree** — rejected: same friction/value tradeoff, plus blurs the public/private repo boundary that exists for a real reason.
- **No folder at all** — rejected: the user specifically wants the extension visible as a component of this project, not just referenced in prose.
