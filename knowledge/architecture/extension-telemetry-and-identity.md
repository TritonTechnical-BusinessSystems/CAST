---
status: active
read-when: Designing or touching the extension's update-freshness banner, its device/user identity reporting, or the CAST web app's check-in catalog.
related: [browser-extension.md, ../decisions/0004-monorepo-with-artifacts-only-public-surface.md]
updated: 2026-07-18
---

# Extension telemetry & identity — design record

Covers three related but distinct things the extension needs to know about
itself and report: (1) whether it's still getting fresh updates/config, (2)
who/what it's running as, and (3) what it tells the CAST web app when it
checks in. Companion to `browser-extension.md`
(the extension's UI-manipulation design) — this file is about its
observability and identity surface.

---

## 1. "Stale for X days" banner

**Do not** use `chrome.runtime.requestUpdateCheck()` as the source of truth
for this. Its documented outcomes are only `throttled` / `no_update` /
`update_available` — there is no documented "failed/unreachable" status, so
it can't reliably distinguish "checked successfully, nothing new" from "the
network check never landed." (`no_update`/`update_available` *do* reliably
imply success, but the failure case is unverified, so don't build the
banner's correctness on it.)

**Actual design:** the extension's own background script, on a
`chrome.alarms` timer, makes its own explicit fetch (this can be the same
request as the rules-JSON refresh, §3). Only on a successful response, write
a timestamp to `chrome.storage.local`. On every alarm tick and on browser
startup, compare "now" against that stored timestamp; past the configured
threshold (X days — not yet decided, presumably matches the rules-refresh
cadence), show the banner. This gives unambiguous, fully-controlled
success/failure detection instead of relying on Chrome's opaque updater.

`chrome.runtime.requestUpdateCheck()` can still be called on the same
schedule as a secondary nudge (prompts Chrome to check for a new extension
*version* sooner than its own ~5 hour internal timer) — just not as the
banner's data source.

## 2. Identity: what NOT to use, and what to use instead

**Explicitly ruled out: `chrome.identity.getProfileUserInfo()`.** It
reports whatever Google/Microsoft account a person has signed into their
*browser profile* with — which has no reliable relationship to their
Windows/AD account. Users may sign into Chrome/Edge with a personal
account, a different work account, or nothing at all, even on a
company-issued, correctly-AD-joined device. Do not use this API for
identity anywhere in this design.

**Windows OS account name — via `chrome.storage.managed`:**
- Same mechanism as the device identifier below, but scoped to
  `HKEY_CURRENT_USER` (not `HKEY_LOCAL_MACHINE`) under
  `Software\Policies\Google\Chrome\3rdparty\extensions\{id}\policy` (Chrome)
  / the equivalent `Policies\Microsoft\Edge\...` path (Edge).
- Unlike the device identifier (a static, set-once-at-deploy value), this
  value must be **refreshed at each Windows logon**, since a machine could
  have more than one user over its life. Deliver via a GPO "User
  Configuration → Preferences → Registry" item (auto-substitutes the
  logged-in username, fires every logon) or, if GPO isn't in play, a
  scheduled task set to "run at logon, only when user is logged on" that
  writes the current username to that user's `HKCU` hive.
- This is genuinely independent of whatever's happening at the Chrome/Edge
  profile-sign-in level — it comes from the OS/deployment layer, not
  anything configurable inside the browser.

**Device identifier — via `chrome.storage.managed`, machine-wide:**
- Same `chrome.storage.managed` mechanism, scoped to `HKLM` (machine-wide,
  set once at deploy time via the existing Pulseway script, alongside the
  forcelist registry value).
- Extensions can't read the OS hostname directly (no such extension API) —
  this managed-storage injection is the workaround, reusing deployment
  tooling that already exists for the forcelist.
- Alternative considered: a native-messaging companion executable could
  read the live OS hostname directly — heavier (needs its own install +
  native-messaging manifest registration per machine) — only worth it if
  managed storage proves insufficient.

**Report both CW user and OS account name, don't replace one with the
other.** `member.memberID` (from the existing `localStorage` session read,
`browser-extension.md` §3) still drives the actual
role/department rule engine. The OS account name exists purely so a
check-in from a machine that's *never logged into ConnectWise* isn't
identity-less. They usually point at the same person, but serve different
jobs.

**macOS — open question, not yet resolved.** macOS supports the same
device-vs-user policy scope distinction in concept, but the delivery
mechanism differs: device-wide values go in `/Library/Managed
Preferences/<bundle-id>.plist` (root-writable, scriptable without full
MDM); genuinely user-scoped values are really only well-supported via an
MDM pushing a **User**-scoped configuration profile (MCX, the old
per-user-without-MDM mechanism, is deprecated). **Whether Triton has any
Mac MDM in place is still unanswered** — if yes, use a User-scoped profile
for the OS-account-name value, same idea as the Windows GPO approach; if
no, the workaround is a login-triggered script overwriting the single
machine-wide plist value with whoever just logged in (works for
effectively-single-user company Macs, doesn't give true simultaneous
per-account values the way HKCU does, and needs something to trigger it in
the interactive user's session, not just as root).

## 3. Check-in catalog (CAST web app)

Each instance check-in (interval TBD — likely shares the rules-refresh
`chrome.alarms` cadence, §1) should report:

| Field | Source |
|---|---|
| Browser | `navigator.userAgent` |
| Device identifier | `chrome.storage.managed`, `HKLM`-scoped (§2) |
| OS account name | `chrome.storage.managed`, `HKCU`-scoped, refreshed per logon (§2) |
| CW user | `member.memberID` from the existing `localStorage` session read |
| Extension version | `chrome.runtime.getManifest().version` |
| Settings/rules version | Tag embedded in the rules JSON payload, cached in `chrome.storage.local` after each successful fetch |
| Last check-in | **Free** — the server's own receipt timestamp on each logged check-in row; no client-side tracking needed |

This is ordinary application engineering on the server side (a check-ins
table, queryable for "last seen" per device/user) — no Chrome API
constraints apply to the check-in POST itself, since it's the extension's
own code making a normal authenticated-or-not fetch to the CAST web app,
which lives behind the VPN-gated internal network (not the public
artifacts host — see `../decisions/0004-monorepo-with-artifacts-only-public-surface.md`).
