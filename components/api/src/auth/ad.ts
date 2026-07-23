/**
 * Active Directory authentication over LDAPS, gated by "CAST Users" group
 * membership. PRIMARY login path (cast-web-app-mockup.md §2). Valid
 * credentials alone are not enough — non-members are denied.
 *
 * Working skeleton — the LDAPS bind/group-check flow is real but not yet run
 * against Triton's live AD. Mechanism itself still open (INIT-0008); this is
 * the LDAPS-bind option, the likely fit for Docker-on-Linux.
 */
import { Client } from "ldapts";
import { config, adConfigured } from "../config";
import type { Role } from "./permissions";
import { roleForGroups, DEFAULT_ROLE } from "./accessConfig";

export interface AuthedUser {
  id: string;
  displayName: string;
  source: "ad" | "local";
  role: Role;
}

export type AuthResult =
  | { ok: true; user: AuthedUser }
  | { ok: false; reason: string };

export async function authenticateAD(username: string, password: string): Promise<AuthResult> {
  if (!adConfigured()) return { ok: false, reason: "ad-not-configured" };
  if (!username || !password) return { ok: false, reason: "missing-credentials" };

  const client = new Client({ url: config.ldapUrl });
  try {
    // 1. Service-account bind to look the user up.
    await client.bind(config.ldapBindDN, config.ldapBindPassword);
    const { searchEntries } = await client.search(config.ldapBaseDN, {
      scope: "sub",
      filter: `(&(objectClass=user)(sAMAccountName=${escapeFilter(username)}))`,
      attributes: ["distinguishedName", "displayName", "sAMAccountName"],
    });
    const entry = searchEntries[0];
    if (!entry) return { ok: false, reason: "user-not-found" };
    const userDN = String(entry.distinguishedName);

    // 2. Re-bind AS the user to verify their password.
    await client.unbind();
    const userClient = new Client({ url: config.ldapUrl });
    try {
      await userClient.bind(userDN, password);
    } catch {
      return { ok: false, reason: "invalid-credentials" };
    } finally {
      await userClient.unbind().catch(() => {});
    }

    // 3. Require CAST Users membership (nested via the recursive matching-rule
    //    OID 1.2.840.113556.1.4.1941), then resolve the user's role from groups.
    let role: Role = DEFAULT_ROLE;
    const memberClient = new Client({ url: config.ldapUrl });
    try {
      await memberClient.bind(config.ldapBindDN, config.ldapBindPassword);
      const { searchEntries: groupHits } = await memberClient.search(config.ldapBaseDN, {
        scope: "sub",
        filter: `(&(sAMAccountName=${escapeFilter(username)})(memberOf:1.2.840.113556.1.4.1941:=${config.ldapAllowedGroupDN}))`,
        attributes: ["sAMAccountName"],
      });
      if (groupHits.length === 0) return { ok: false, reason: "not-in-cast-users-group" };

      // Role from the user's group CNs (direct memberOf; nested role-groups can
      // be added later with the same recursive OID). Map in auth/accessConfig.ts.
      const { searchEntries: userEntries } = await memberClient.search(userDN, { scope: "base", attributes: ["memberOf"] });
      const mo = userEntries[0]?.memberOf;
      const dns = Array.isArray(mo) ? mo.map(String) : mo ? [String(mo)] : [];
      const cns = dns.map((dn) => /^CN=([^,]+)/i.exec(dn)?.[1] ?? "").filter(Boolean);
      role = roleForGroups(cns);
    } finally {
      await memberClient.unbind().catch(() => {});
    }

    return {
      ok: true,
      user: {
        id: String(entry.sAMAccountName ?? username),
        displayName: String(entry.displayName ?? username),
        source: "ad",
        role,
      },
    };
  } catch {
    // "AD unreachable" vs. "bad password" so the UI can steer toward the
    // local-account fallback only when AD is actually down.
    return { ok: false, reason: "ad-unreachable" };
  } finally {
    await client.unbind().catch(() => {});
  }
}

/** Escape LDAP filter special characters (RFC 4515). */
function escapeFilter(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => "\\" + c.charCodeAt(0).toString(16).padStart(2, "0"));
}
