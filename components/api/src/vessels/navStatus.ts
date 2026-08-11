/**
 * AIS navigational-status codes (ITU-R M.1371) -> friendly buckets for the
 * Vessel Site writer. The architecture note already decided the shape
 * (Moored / At anchor / Under way, plus a stale/unknown bucket keyed on
 * last-seen — "dry-docked" isn't a real AIS code, a powered-down vessel just
 * stops transmitting).
 */
export type StatusBucket = "docked" | "anchored" | "underway" | "aground" | "unknown";

const CODE_TO_BUCKET: Record<number, StatusBucket> = {
  0: "underway", // under way using engine
  1: "anchored",
  2: "underway", // not under command — still "not docked", generic underway phrasing
  3: "underway", // restricted manoeuverability
  4: "underway", // constrained by draught
  5: "docked", // moored
  6: "aground",
  7: "underway", // engaged in fishing
  8: "underway", // under way sailing
  // 9-14: reserved/special-craft codes, 15: undefined — all fall through to "unknown" below.
};

/** How long without a message before we stop trusting the last-known status and call it unknown instead. */
export const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

export function statusBucket(navStatusCode: number | null, lastSeenAt: string | null): StatusBucket {
  if (!lastSeenAt || Date.now() - new Date(lastSeenAt).getTime() > STALE_THRESHOLD_MS) return "unknown";
  if (navStatusCode == null) return "unknown";
  return CODE_TO_BUCKET[navStatusCode] ?? "unknown";
}
