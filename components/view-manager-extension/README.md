# CAST browser extension — source

This is the extension's real source location, inside the private CAST
monorepo — not a separate repo, not a checkout, not a reference
pointer. It's developed alongside the CAST web app (its sibling
component) in lockstep, in the same history. Why: `../../knowledge/decisions/0004-monorepo-with-artifacts-only-public-surface.md`
(supersedes the earlier reference-only-folder / separate-repo plan in
`../../knowledge/decisions/0003-extension-repo-topology.md`).

Public-facing name: **CAST**, same brand as the web app (previously "Triton
View Manager for ConnectWise" during planning).

- **Full design/decision record:** `../../knowledge/architecture/browser-extension-view-manager.md`
- **Nothing in this folder is ever published as source.** Releases publish
  only CI-generated build output (`.crx`, `update-manifest.xml`, rules
  JSON) to an unlisted public host — see the architecture doc §7 and
  `INIT-0001`.
- **Config schema:** the rules/config JSON this extension consumes at
  runtime is authored by the CAST web app (`INIT-0008`) — a
  sibling component in this same monorepo.

No code lives here yet — this is a placeholder until the extension's own
scaffolding work begins.
