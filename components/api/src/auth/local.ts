/**
 * Local-account fallback for when AD is unreachable. Deliberately secondary;
 * intended for a small break-glass admin set, not per-user provisioning.
 *
 * TODO(INIT-0008): back this with a persistent store of break-glass accounts
 * (bcrypt hashes via ./password), mirroring the SOC users table. Returns
 * "invalid-credentials" until that store exists — no hardcoded credentials.
 */
import type { AuthResult } from "./ad";
import { verifyPassword } from "./password";

interface LocalAccount {
  username: string;
  displayName: string;
  passwordHash: string;
}

export async function authenticateLocal(username: string, password: string): Promise<AuthResult> {
  const account = await lookupLocalAccount(username);
  if (!account) return { ok: false, reason: "invalid-credentials" };
  if (!verifyPassword(password, account.passwordHash)) {
    return { ok: false, reason: "invalid-credentials" };
  }
  return { ok: true, user: { id: account.username, displayName: account.displayName, source: "local" } };
}

/** TODO(INIT-0008): replace with a real break-glass account store. */
async function lookupLocalAccount(_username: string): Promise<LocalAccount | null> {
  return null;
}
