/**
 * Local-account auth — the break-glass fallback for when AD is unreachable, and
 * the seed for the "TritonAdmin" admin account. Backed by the sqlite
 * local_accounts table; passwords are bcrypt (./password). Deliberately secondary
 * to AD, for a small admin set — not per-user provisioning.
 */
import type { AuthResult } from "./ad";
import { db } from "../store/db";
import { hashPassword, verifyPassword } from "./password";
import type { Role } from "./permissions";
import { randomBytes } from "crypto";

interface Row {
  username: string;
  password_hash: string;
  display_name: string;
  role: string;
  disabled: number;
  must_change_password: number;
}

/**
 * `RESET_PENDING:<ISO timestamp>` is a deliberate reset-pending sentinel —
 * unambiguous (bcrypt hashes always start with `$2`, never with `R`) and,
 * unlike a bare empty string, time-bound and auditable. Set ONLY by a human
 * admin action outside this app (a direct DB update, see
 * knowledge/architecture/cast-web-app-auth.md) when the account holder is
 * locked out and needs back in without knowing the current password — NEVER
 * automatically by this app's own code (see `seedBreakGlass` below; a first
 * version of this auto-armed it on every unattended first boot, which a
 * security review correctly rejected as a remotely-reachable admin-takeover
 * window with no human required to trigger it).
 *
 * A window, not an indefinite bypass (security review, 2026-08-21 BLOCKED
 * the first version of this over exactly this: the armed state had no
 * expiry, no audit trail, and — separately — the completing password
 * change didn't re-verify the DB was still in that state, so a second party
 * who logged in during the window could reuse their session to overwrite
 * the password again even after the real owner finished recovering).
 * `RESET_WINDOW_MS` bounds how long the bypass stays live in EITHER time
 * direction (a second security pass caught that a future-dated timestamp —
 * clock skew, or a malformed non-UTC string — failed OPEN under a naive
 * `elapsed > window` check); every reset-pending login and every
 * completed/expired attempt is logged.
 */
const RESET_PENDING_PREFIX = "RESET_PENDING:";
const RESET_WINDOW_MS = 30 * 60 * 1000;

function resetArmedAt(passwordHash: string): Date | null {
  if (!passwordHash.startsWith(RESET_PENDING_PREFIX)) return null;
  const d = new Date(passwordHash.slice(RESET_PENDING_PREFIX.length));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** True only within the live window, in EITHER time direction — a future-dated (clock-skew or malformed) timestamp fails closed exactly like an expired one, not open. */
function withinResetWindow(armedAt: Date): boolean {
  const elapsedMs = Date.now() - armedAt.getTime();
  return elapsedMs >= 0 && elapsedMs <= RESET_WINDOW_MS;
}

export async function authenticateLocal(username: string, password: string): Promise<AuthResult> {
  const row = db
    .prepare("SELECT username, password_hash, display_name, role, disabled, must_change_password FROM local_accounts WHERE username = ? COLLATE NOCASE")
    .get(username) as Row | undefined;
  if (!row || row.disabled) return { ok: false, reason: "invalid-credentials" };

  const armedAt = resetArmedAt(row.password_hash);
  if (armedAt) {
    const elapsedMin = Math.round((Date.now() - armedAt.getTime()) / 60_000);
    if (!withinResetWindow(armedAt)) {
      console.warn(`[auth] SECURITY: reset-pending login for "${row.username}" refused — armed ${elapsedMin}m ago (outside the ${RESET_WINDOW_MS / 60_000}m window in either direction). Re-arm to try again.`);
      return { ok: false, reason: "invalid-credentials" };
    }
    console.warn(`[auth] SECURITY: "${row.username}" signed in via the reset-pending bypass (no password verified, armed ${elapsedMin}m ago) — forcing a password change now.`);
    // `viaResetBypass: true` — distinct from the legacy `must_change_password`
    // case below. Both force the same "set a new password" screen, but only
    // THIS one is allowed to skip proving the current password, because only
    // THIS one didn't require knowing it to get in.
    return { ok: true, user: { id: row.username, displayName: row.display_name, source: "local", role: row.role as Role, mustChangePassword: true, viaResetBypass: true } };
  }

  if (!verifyPassword(password, row.password_hash)) return { ok: false, reason: "invalid-credentials" };
  return {
    ok: true,
    user: { id: row.username, displayName: row.display_name, source: "local", role: row.role as Role, mustChangePassword: Boolean(row.must_change_password) },
  };
}

/**
 * For a VOLUNTARY change (current password already verified by the caller
 * via `verifyLocalPassword`) OR for the legacy `must_change_password=1`
 * case (the caller already proved the current password via a normal login
 * moments ago — that column predates the reset-pending sentinel and marks
 * an account that should be prompted to change on next use, not one
 * mid-bypass). Never for the reset-pending bypass itself — that path is
 * `setLocalPasswordIfResetPending`, which needs the extra race guard this
 * function deliberately doesn't have.
 */
export function setLocalPassword(username: string, newPassword: string): void {
  db.prepare("UPDATE local_accounts SET password_hash = ?, must_change_password = 0 WHERE username = ? COLLATE NOCASE").run(
    hashPassword(newPassword),
    username,
  );
}

/**
 * For the RESET-PENDING BYPASS path only — atomic: the UPDATE's own WHERE
 * clause re-checks the row is STILL `RESET_PENDING:` at the moment of the
 * write, not just trusting the caller's JWT claim. Returns false (writes
 * nothing) if the state already moved on — completed, or never armed —
 * which is exactly what stops a second party who logged in during the same
 * window from reusing their session to overwrite the password again after
 * the real owner already finished.
 */
export function setLocalPasswordIfResetPending(username: string, newPassword: string): boolean {
  const result = db
    .prepare("UPDATE local_accounts SET password_hash = ?, must_change_password = 0 WHERE (username = ? COLLATE NOCASE) AND password_hash LIKE 'RESET_PENDING:%'")
    .run(hashPassword(newPassword), username);
  return result.changes > 0;
}

/** For a VOLUNTARY password change's current-password check — never succeeds against a reset-pending sentinel (there's no real password to "verify" yet). */
export function verifyLocalPassword(username: string, password: string): boolean {
  const row = db.prepare("SELECT password_hash FROM local_accounts WHERE username = ? COLLATE NOCASE").get(username) as { password_hash: string } | undefined;
  if (!row || resetArmedAt(row.password_hash)) return false;
  return verifyPassword(password, row.password_hash);
}

/**
 * Seed the TritonAdmin break-glass admin at startup if it doesn't exist.
 *
 * Without `CAST_BREAKGLASS_PASSWORD`, this seeds a REAL (unknown, unlogged)
 * random password — the account is effectively locked until someone runs
 * the SAME manual recovery procedure any locked-out local account uses
 * (knowledge/architecture/cast-web-app-auth.md). That's deliberate, not a
 * bug: this app's own code must NEVER auto-arm the reset-pending bypass
 * unattended. A first version of this function did exactly that — armed a
 * live `RESET_PENDING:` window on every fresh boot / recreated data volume /
 * wiped `.data` dir, none of which require a human to be present, unlike
 * the real recovery procedure where an admin arms and consumes the window
 * themselves within minutes. A security review correctly rejected that as
 * a remotely-reachable, unattended admin-takeover window on a documented,
 * fixed username — a strictly worse trade than the original problem it was
 * fixing (a generated password sitting in cleartext logs, which at least
 * required log access, not just network reach and timing, to exploit).
 */
export function seedBreakGlass(): void {
  const exists = db.prepare("SELECT 1 FROM local_accounts WHERE username = ? COLLATE NOCASE").get("TritonAdmin");
  if (exists) return;
  const provided = process.env.CAST_BREAKGLASS_PASSWORD;
  const password = provided && provided.length >= 8 ? provided : randomBytes(24).toString("base64url");
  db.prepare(
    "INSERT INTO local_accounts (username, password_hash, display_name, role, must_change_password, disabled, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)",
  ).run("TritonAdmin", hashPassword(password), "Triton Admin (break-glass)", "admin", new Date().toISOString());
  if (provided) {
    console.log('[cast-api] Break-glass account "TritonAdmin" seeded from CAST_BREAKGLASS_PASSWORD.');
  } else {
    console.log(
      '[cast-api] Break-glass "TritonAdmin" seeded with an unknown, unlogged password — nothing can sign in yet. ' +
        "To bootstrap access, run the same manual reset procedure any locked-out local account uses " +
        "(knowledge/architecture/cast-web-app-auth.md) — an admin arms a time-bound window and signs in within it.",
    );
  }
}
