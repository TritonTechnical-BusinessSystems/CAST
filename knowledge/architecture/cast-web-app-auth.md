---
status: active
read-when: Configuring CAST web app login/authorization — the break-glass admin, the AD group→role mapping, or the roles/permissions model.
related: [../decisions/0002-extension-never-touches-cw-credentials.md, cast-web-app-vm-provisioning.md]
updated: 2026-07-23
---

# CAST web app — authentication & authorization

Two ways in, one authorization model.

## Ways in
1. **Active Directory (primary).** LDAPS bind, gated by the **CAST Users** group —
   valid credentials alone aren't enough; non-members are denied. Configure via the
   `CAST_LDAP_*` env vars in `components/api/.env`. AD is "configured" once
   `CAST_LDAP_URL`, `CAST_LDAP_BASE_DN`, and `CAST_LDAP_ALLOWED_GROUP_DN` are set.
2. **Local break-glass — "TritonAdmin".** One admin account for when AD is
   unreachable (or before AD is wired). Seeded automatically at first boot, always
   role **admin**. Set its password with `CAST_BREAKGLASS_PASSWORD` in `.env`; if
   blank, a random password is generated and printed to the server log once. Change
   it after first login.

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
