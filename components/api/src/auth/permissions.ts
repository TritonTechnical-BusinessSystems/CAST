/**
 * CAST authorization model — roles and the permissions each grants.
 *
 * A user has one ROLE (from their AD group mapping, or "admin" for the local
 * break-glass account). A role grants a set of PERMISSIONS. Routes check
 * permissions (see middleware/auth.ts `requirePermission`); the SPA hides
 * controls the user lacks. Expand the permission list + role bundles as the app
 * grows — this is the single source of truth for "who can do what".
 */
export const PERMISSIONS = [
  "extension.read",     // view CAST Extension config
  "extension.write",    // edit role/department rules, expected pods
  "vessel.read",        // view vessel pages
  "vessel.reconcile",   // resolve/write IMO/MMSI (still gated by CW_WRITES_ENABLED)
  "tracking.read",      // view Vessel Tracking Config
  "tracking.write",     // edit the tracking rule
  "integrations.read",  // view integration status
  "integrations.write", // enter/update credentials
  "system.read",        // view System Health
  "accounts.manage",    // manage local break-glass accounts
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type Role = "admin" | "operator" | "viewer";
export const ROLES: Role[] = ["admin", "operator", "viewer"];

const VIEWER: Permission[] = ["extension.read", "vessel.read", "tracking.read", "integrations.read", "system.read"];
const OPERATOR: Permission[] = [...VIEWER, "extension.write", "vessel.reconcile", "tracking.write"];

/** Role → permissions. `admin` gets everything (incl. future additions). */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [...PERMISSIONS],
  operator: OPERATOR,
  viewer: VIEWER,
};

export function permissionsFor(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? VIEWER;
}

export function hasPermission(role: Role, perm: Permission): boolean {
  return permissionsFor(role).includes(perm);
}
