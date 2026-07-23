# ADR 0004 — Single private monorepo; the extension's public surface is CI-generated artifacts only

**Status:** Accepted · 2026-07-18
**Related:** `knowledge/decisions/0003-extension-repo-topology.md` (superseded), `knowledge/decisions/0002-extension-never-touches-cw-credentials.md`, `knowledge/architecture/browser-extension.md`, `INIT-0001`, `INIT-0008`

## Context
ADR-0003 chose separate repos (extension public, everything else private) plus a reference-only local folder, reasoning that the config schema — not code proximity — was the real coupling point, and that submodule/subtree overhead wasn't worth paying for mere local visibility.

Two things sharpened since then:
1. The browser extension and the new **CAST web app** must always be developed together — a change to one routinely requires a change to the other, not occasionally. Cross-repo atomicity (one commit/PR spanning both) is now a real, recurring need, not a nice-to-have — the coordination tax ADR-0003 accepted (two commits, two PRs, manual cross-linking) would be paid on every coupled change, forever.
2. The *only* reason any part of this needs to be public at all is Chrome's extension auto-update mechanism: it fetches an `update_url`-referenced manifest and a `.crx` over plain, unauthenticated HTTPS. It does not require the extension's *source* to be public, does not require GitHub specifically, and there is no plan for external/community contributions to the extension that would otherwise justify an open, browsable repo.

## Decision
1. **CAST is a single private monorepo.** All source — the extension, the CAST web app, the scheduled data-sync service, and this canon — lives here, one history, real atomic commits/PRs across coupled changes. `components/browser-extension/` becomes the extension's actual source location, not a reference-only pointer (this replaces that part of ADR-0003).
2. **The extension's public-facing surface is CI-generated build output only** — the packaged `.crx`, `update-manifest.xml`, and the runtime rules JSON — never source code, never a browsable repository. This output is published by an automated release step; nobody hand-edits or hand-pushes it.
3. **The publish target should be as undiscoverable as the update mechanism allows.** Prefer an unlisted static host (e.g. a storage bucket/container with directory listing disabled, no public links pointing to it, no listing anywhere) over a public GitHub repo — a public repo is inherently more discoverable (the org's public-repos page, GitHub search) with no corresponding benefit, since no external contribution is wanted. Exact hosting mechanism is not yet chosen — tracked in `INIT-0001`'s fleshing-out notes.
4. **A hard floor applies regardless of hosting choice:** the artifacts must be fetchable by anyone with the exact URL, since Chrome's updater can't authenticate. "Hidden" here means *unlisted/undiscoverable*, not *access-controlled*. If genuine access control is ever required, that means restricting reachability at the network layer instead (internal/VPN/IP-allowlisted, viable since all deployment targets are AD-joined and org-controlled) — held as a future hardening option, not the default, since it adds real infrastructure and risks update failures for any device off that network at check time.

## Consequences
- (+) Single repo/history gives real atomic commits/PRs across the extension and CAST web app — directly serves the "always developed together" requirement that prompted revisiting ADR-0003.
- (+) No source code, and no browsable repo UI, is ever public — more private than ADR-0003's separate-public-repo approach, with no loss of update functionality.
- (+) No submodule/subtree/dual-history coordination tax at all — strictly less friction than ADR-0003's sibling-repos approach, since it's genuinely one repo.
- (−) Requires a release/CI pipeline to build and publish the artifacts — a one-time setup cost, though some form of this exists under every option considered.
- (−) "Unlisted" is not "access-controlled" — anyone who obtains the exact artifact URL can fetch it. Consistent with the existing threat model (`knowledge/decisions/0002-extension-never-touches-cw-credentials.md`): this content is already low-sensitivity, no credentials.

## Alternatives considered
- **ADR-0003's sibling-repos approach** — rejected now that "always developed together" is an explicit, ongoing requirement; the coordination tax it accepted is exactly what a single monorepo avoids.
- **Monorepo + source mirrored out to a public repo** (raised mid-discussion) — rejected: unnecessarily exposes source when Chrome's update mechanism only ever needs build *artifacts*.
- **Public GitHub repo as the artifacts host** — viable, but not the default: more discoverable than an unlisted static host for no corresponding benefit, given no external-contribution use case.
- **Network-restricted (VPN/IP-allowlisted) hosting** — the strongest privacy option, held back as a future upgrade rather than the default: adds infrastructure and risks update-delivery failures for any device off that network.
