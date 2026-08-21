---
status: active
read-when: Configuring CAST web app login/authorization — the break-glass admin, the AD group→role mapping, or the roles/permissions model.
related: [../decisions/0002-extension-never-touches-cw-credentials.md, cast-web-app-vm-provisioning.md]
updated: 2026-08-21
---

# CAST web app — authentication & authorization

Two ways in, one authorization model.

## The session cookie is scoped to `/api` — don't widen it
`cast_token` is set with **`path: "/api"`** (`middleware/auth.ts`), not Express's
default `/`. Cookies are scoped by host and path but **not by port**, so a
`/`-scoped cookie was being attached to every request to the `deploy-monitor`
container on `:20443` (`INIT-0038`) — the one browser-facing process in the stack
that is deliberately denied every other credential. It can't verify the token,
but it received a live admin JWT in plain request headers (security gate BLOCK,
2026-08-21). Every route that reads this cookie is mounted under `/api/*`
(`server.ts`), so the narrower path costs nothing.

Two consequences to preserve if this is ever touched:
- **`clearCookie` must pass the same path.** It only matches a cookie whose path
  matches, so a mismatch means logout silently leaves a live session in the
  browser. `clearSession` clears both `/api` and the legacy `/`.
- **`issueSession` evicts a legacy `path=/` cookie before setting the new one.**
  Path is part of a cookie's identity, so a returning browser would otherwise hold
  both and send two `cast_token` values on every `/api` request.

The PDF renderer's internal cookie (`pdf/render.ts`) intentionally stays at
`path: "/"` — it lives only in an ephemeral internal Playwright context that
never reaches the monitor.

## Ways in
1. **Active Directory (primary).** LDAPS bind, gated by the **CAST Users** group —
   valid credentials alone aren't enough; non-members are denied. Configure via the
   `CAST_LDAP_*` env vars in `components/api/.env`. AD is "configured" once
   `CAST_LDAP_URL`, `CAST_LDAP_BASE_DN`, and `CAST_LDAP_ALLOWED_GROUP_DN` are set.
2. **Local break-glass — "TritonAdmin".** One admin account for when AD is
   unreachable (or before AD is wired). Seeded automatically at first boot, always
   role **admin**. Set its password with `CAST_BREAKGLASS_PASSWORD` in `.env`; if
   blank, the account seeds with an **unknown, unlogged random password** — it's
   locked until an admin runs the manual reset procedure below. This app's own
   code never auto-arms a bypass unattended, full stop — an earlier version of
   this seeded straight into the reset-pending state on every fresh boot instead,
   which a security review correctly rejected as a remotely-reachable,
   unattended admin-takeover window (worse than the cleartext-log problem it was
   meant to fix, which at least required log access to exploit).

   **Locked out and don't know the current password? (INIT-0036, 2026-08-21)**
   There's no self-service "forgot password" — that would be a standing
   authentication bypass on the highest-privilege account, not something to expose
   as a public flow. Instead, an admin with real DB access puts the account into a
   **time-bound** reset-pending state directly:
   ```
   docker exec cast-api node -e "
     const db = require('better-sqlite3')('/app/components/api/.data/cast.db');
     db.prepare(\"UPDATE local_accounts SET password_hash = ?, must_change_password = 1 WHERE username = 'TritonAdmin'\")
       .run('RESET_PENDING:' + new Date().toISOString());
   "
   ```
   `RESET_PENDING:<ISO timestamp>` is a deliberate sentinel (bcrypt hashes always
   start with `$2`, never `R`) — **within 30 minutes of that timestamp, in either
   direction** (`auth/local.ts`'s `RESET_WINDOW_MS`; a future-dated timestamp —
   clock skew, or a hand-written non-UTC string — fails closed exactly like an
   expired one, not open), the next local-mode login for that username succeeds
   with ANY password, including a blank one, and the session is immediately
   forced through `POST /api/auth/local/change-password` (`SetNewPassword.tsx` on
   the frontend; `middleware/auth.ts`'s `requireAuth`/`requirePermission` 403
   every OTHER route with `reason: "must-change-password"` until that happens) —
   no route bypasses this by navigating around it. Past the window the bypass
   stops working on its own (re-arm it to try again, same command). Every
   reset-pending login, every completed reset, and every expired-window refusal
   is logged (`console.warn`, `docker logs cast-api`) — this is a real
   authentication bypass while armed, so it's auditable, not silent. The
   completing password change is atomic against the DB, not just the session's
   JWT claim (`setLocalPasswordIfResetPending`) — if two people signed in during
   the same armed window, only the first to actually complete the change wins;
   the second's attempt is refused (409) once the state's moved on, so recovery
   genuinely closes the window rather than leaving it open to whoever still holds
   a `mustChangePassword: true` session.

   Two other cases land on the same "set a new password" screen but take a
   different write path server-side, distinguished by `viaResetBypass` (set only
   at the moment of authentication, never re-derived later — re-deriving it from
   a later DB read turned out to be ambiguous between "a racer's sentinel was
   already consumed" and "this account was never a bypass case at all"):
   - **Legacy forced-change** — an account with `must_change_password=1` and a
     REAL password (the column's existed since day one, set on every
     freshly-generated seed, but nothing checked it until this). It authenticates
     normally with its real password, so no bypass occurred — the change is a
     plain write, no current-password re-entry or atomic race guard needed
     (already proven via the login itself).
   - **Voluntary change** — neither flag set. Requires proving `currentPassword`
     first (`verifyLocalPassword`) — a live session alone was never enough on its
     own to silently rewrite the password.

## Authorization — roles & permissions
- **Permissions** (capabilities) and which **role** grants them live in
  `components/api/src/auth/permissions.ts`. Three roles ship: `admin` (everything),
  `operator` (edit config, reconcile vessels, tracking), `viewer` (read-only). Add
  permissions or adjust the bundles there.
- Routes enforce them (`requirePermission(...)`); the SPA hides what a user can't do
  (e.g. **Integrations** is admin-only).

## ← The main thing to fill in: AD groups → roles
Edit **`components/api/src/auth/accessConfig.ts`**:
- Replace the placeholder `adGroup` values in `AD_GROUP_ROLE_MAP` with your real AD
  security-group names (the CN, e.g. `CAST-Admins`; case-insensitive).
- A user in several mapped groups gets the **highest** role; a CAST-Users member in
  no mapped group gets `DEFAULT_ROLE` (viewer).
- That's it — no other code changes needed.

## Quick start (log in today)
1. Set `CAST_BREAKGLASS_PASSWORD=<something strong>` in `components/api/.env`, redeploy.
2. Login screen → "use a local account" → **TritonAdmin** / that password.
3. Wire AD when ready: fill `CAST_LDAP_*` + the group→role map, restart.
