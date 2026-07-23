/**
 * Local-account password hashing — bcrypt, matching the SOC backend's
 * convention (bcryptjs, cost 12). Local accounts are the break-glass fallback
 * for when AD is unreachable (naming-lexicon.md: "Local Account").
 */
import bcrypt from "bcryptjs";

const COST = 12;

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, COST);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}
