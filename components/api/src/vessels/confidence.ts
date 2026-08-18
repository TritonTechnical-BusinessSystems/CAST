/**
 * How much CAST still trusts a vessel's last-reported status, given its age
 * — split out from the old flat 6-hour "unknown" cutoff (`navStatus.ts`,
 * pre-2026-08-17) into a per-bucket model, decided with the user the same
 * day the confidence colors were designed:
 *
 * - Stationary (docked/anchored): a vessel doesn't relocate without
 *   transmitting somewhere — a long silence in a shipyard is the NORMAL
 *   case, not a failure. Presumed accurate indefinitely (up to FALLBACK_MS).
 * - Underway with a stated destination + ETA: presumed accurate through
 *   ETA + a grace window — ships don't vanish off their route in hours.
 * - Underway with no destination, aground, or an unrecognized/reserved
 *   nav-status code: nothing to reason forward from — stale as soon as it's
 *   not fresh. Aground is deliberately NOT treated as stationary (user,
 *   2026-08-17): it's an incident, not a resting state, so it doesn't get
 *   the same indefinite benefit of the doubt as a vessel that's simply
 *   docked — real urgency handling belongs to Geo Alerts (INIT-0017), not
 *   this color scheme.
 *
 * Past FALLBACK_MS with no fresher signal at all, confidence in ANYTHING —
 * even "still in the yard" — runs out; the caller falls back to a bare,
 * unstatused site rather than keep aging a guess indefinitely.
 */
import type { StatusBucket } from "./navStatus";
import { vesselStatusFallbackDays } from "../config";

export type ConfidenceTier = "current" | "presumed" | "stale" | "expired";

export const FRESH_WINDOW_MS = 2 * 60 * 60 * 1000; // 2h — 🟢
export const ETA_GRACE_MS = 48 * 60 * 60 * 1000; // 48h past ETA — still 🔵

const STATIONARY: StatusBucket[] = ["docked", "anchored"];

export function confidenceTier(
  bucket: StatusBucket,
  opts: { lastSeenAt: string | null; destination: string | null; etaIso: string | null },
): ConfidenceTier {
  if (!opts.lastSeenAt) return "expired";
  const now = Date.now();
  const lastSeen = new Date(opts.lastSeenAt).getTime();
  const age = now - lastSeen;
  // Read fresh on every call, not cached — an in-app change to the fallback
  // duration (setVesselStatusFallbackDays) takes effect on the very next
  // write, same precedent as tierRefreshMinutes.
  const fallbackMs = vesselStatusFallbackDays() * 24 * 60 * 60 * 1000;
  const expired = age > fallbackMs;

  if (age <= FRESH_WINDOW_MS) return "current";
  if (expired) return "expired";

  if (STATIONARY.includes(bucket)) return "presumed";

  if (bucket === "underway" && opts.destination && opts.etaIso) {
    const eta = new Date(opts.etaIso).getTime();
    if (!Number.isNaN(eta) && now <= eta + ETA_GRACE_MS) return "presumed";
  }

  return "stale";
}

export const TIER_EMOJI: Record<Exclude<ConfidenceTier, "expired">, string> = {
  current: "🟢",
  presumed: "🔵",
  stale: "🟠",
};
