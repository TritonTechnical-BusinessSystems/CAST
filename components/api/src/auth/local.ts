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
}

export async function authenticateLocal(username: string, password: string): Promise<AuthResult> {
  const row = db
    .prepare("SELECT username, password_hash, display_name, role, disabled FROM local_accounts WHERE username = ? COLLATE NOCASE")
    .get(username) as Row | undefined;
  if (!row || row.disabled) return { ok: false, reason: "invalid-credentials" };
  if (!verifyPassword(password, row.password_hash)) return { ok: false, reason: "invalid-credentials" };
  return { ok: true, user: { id: row.username, displayName: row.display_name, source: "local", role: row.role as Role } };
}

/** Seed the TritonAdmin break-glass admin at startup if it doesn't exist. */
export function seedBreakGlass(): void {
  const exists = db.prepare("SELECT 1 FROM local_accounts WHERE username = ? COLLATE NOCASE").get("TritonAdmin");
  if (exists) return;
  const provided = process.env.CAST_BREAKGLASS_PASSWORD;
  const password = provided && provided.length >= 8 ? provided : randomBytes(12).toString("base64url");
  db.prepare(
    "INSERT INTO local_accounts (username, password_hash, display_name, role, must_change_password, disabled, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
  ).run("TritonAdmin", hashPassword(password), "Triton Admin (break-glass)", "admin", provided ? 0 : 1, new Date().toISOString());
  if (provided) {
    console.log('[cast-api] Break-glass account "TritonAdmin" seeded from CAST_BREAKGLASS_PASSWORD.');
  } else {
    console.log(`[cast-api] Break-glass "TritonAdmin" seeded with a GENERATED password: ${password}`);
    console.log("[cast-api] Set CAST_BREAKGLASS_PASSWORD in .env to control it; change the password after first login.");
  }
}
