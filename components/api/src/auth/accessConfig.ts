/**
 * ============================================================================
 *  CONFIGURE ME — map your Active Directory groups to CAST roles.
 * ============================================================================
 * Fill `adGroup` with your real AD security-group NAMES (the group's CN, e.g.
 * "CAST-Admins" — case-insensitive). A user who belongs to several mapped groups
 * gets the HIGHEST role. Any authenticated user (passed the CAST Users gate) who
 * matches no mapped group falls back to DEFAULT_ROLE.
 *
 * What each role can do is defined in ./permissions.ts.
 * The local break-glass account "TritonAdmin" is always "admin" (not affected by
 * this file). See knowledge/architecture/cast-web-app-auth.md for the full guide.
 */
import type { Role } from "./permissions";

export interface GroupRoleMapping {
  adGroup: string; // AD security-group CN (case-insensitive)
  role: Role;
  note?: string;
}

export const AD_GROUP_ROLE_MAP: GroupRoleMapping[] = [
  // TODO: replace these placeholder group names with your real AD groups.
  { adGroup: "CAST-Admins", role: "admin", note: "Full admin: config, integrations, accounts." },
  { adGroup: "CAST-Operators", role: "operator", note: "Edit extension config, reconcile vessels, tracking." },
  { adGroup: "CAST-Viewers", role: "viewer", note: "Read-only across the app." },
];

/** Role for an authenticated user who matches no mapped group above. */
export const DEFAULT_ROLE: Role = "viewer";

const RANK: Record<Role, number> = { viewer: 1, operator: 2, admin: 3 };

/** Highest role among the user's AD group CNs (case-insensitive), else default. */
export function roleForGroups(groupCNs: string[]): Role {
  const have = new Set(groupCNs.map((g) => g.toLowerCase()));
  let best: Role = DEFAULT_ROLE;
  for (const m of AD_GROUP_ROLE_MAP) {
    if (have.has(m.adGroup.toLowerCase()) && RANK[m.role] > RANK[best]) best = m.role;
  }
  return best;
}
