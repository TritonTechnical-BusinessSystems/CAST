# ADR 0002 — The browser extension never touches ConnectWise credentials or its private wire protocol

**Status:** Accepted · 2026-07-18
**Related:** `knowledge/architecture/browser-extension.md`

## Context
CAST (formerly named `TritonViewManagerForPSA`, then briefly "Triton View Manager for ConnectWise") is a Chrome/Edge extension that needs a publicly-fetchable update/artifacts surface for the browsers' auto-update mechanism — a hard technical requirement, not a choice (see `0004-monorepo-with-artifacts-only-public-surface.md`) — and needs to both read the current user's role/department and, for one specific capability, add pods to a ConnectWise screen on the user's behalf.

Two temptations were evaluated live against a real ConnectWise instance (`na.myconnectwise.net`, Manage `v2025_1`) and rejected:
- **Craft/replay the internal pod-layout API directly.** `UpdateMemberPodLayoutConfigurationAction.rails` and its siblings take a single opaque GWT-RPC serialized blob tied to the compiled build's serialization policy — not JSON, not stable across ConnectWise versions. Reverse-engineering and replaying this was judged too fragile for the value: it would silently break on every ConnectWise upgrade.
- **Drive the native "Pod Configuration" picker with fully-synthetic DOM events.** A `dispatchEvent` sequence (`mouseover→mousedown→mouseup→click`) with correct target/coordinates/order successfully selected a list item (cosmetic `x-view-highlightrow` applied) but did **not** trigger the move button's actual action. Confirmed conclusively: a standard content script can only dispatch `isTrusted: false` events, and ConnectWise's picker requires a trusted event to fire the real action. Do not re-attempt this without new evidence.

## Decision
The extension operates under two hard rules:
1. **No ConnectWise API credentials of any kind ever live in the extension or its repo.** Role/department detection reads `localStorage['session/MemberWithSecurity']`, already present in the user's authenticated session — no separate credentialed call. The out-of-scope "aggregate cross-system data into new pods" capability is explicitly pushed to ConnectWise's own **Hosted APIs** feature (server-side, properly secured), never to this client-side extension.
2. **Any UI action that ConnectWise itself gates behind a trusted user gesture (e.g. adding a pod) is automated only via a brief, user-initiated `chrome.debugger` attachment** that drives the real native picker sequence, then detaches immediately. It is never used ambiently or in the background, and its "this extension is debugging your browser" banner is treated as an acceptable, visible cost for that brief window — not something to suppress.

## Consequences
- (+) The extension has no credential-exfiltration surface, which matters because its build artifacts (the `.crx`) are published to a public, unlisted host (`0004-monorepo-with-artifacts-only-public-surface.md`), even though the source itself stays private.
- (+) The core hide/show/reorder/move capability (the bulk of the extension) stays simple CSS/DOM work, decoupled from ConnectWise's private wire format and immune to most version upgrades.
- (+) The one privileged action (adding a pod) rides on ConnectWise's own code path, so Triton never owns the correctness of the serialization format.
- (−) The `chrome.debugger` permission shows a visible warning banner during use — accepted, scoped to brief bursts only, with a "guided wizard" (highlight + let the human click) as a fallback if this ever proves too heavy in practice.
- (−) Any future capability that needs real credentialed ConnectWise API access must live server-side (e.g. the separate scheduled data-sync component — `INIT-0002`), never inside this extension.

## Alternatives considered
- **GWT-RPC payload crafting/replay** — rejected: too fragile, breaks on every platform version bump.
- **Fully-synthetic input event automation** — rejected: confirmed not to work: ConnectWise's picker requires trusted input.
- **Store a ConnectWise API key in the extension for the aggregation capability** — rejected outright: violates the org's own API security guidance and the extension's public-artifacts threat model. Use Hosted APIs (server-side) instead.
