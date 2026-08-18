/**
 * AIS navigational-status codes (ITU-R M.1371) -> friendly buckets for the
 * Vessel Site writer. Pure code->bucket mapping only — staleness/confidence
 * (how much we still trust a bucket given its age) is a separate concern,
 * `confidence.ts` (split out 2026-08-17 so the age-based "unknown" cutoff
 * that used to live here doesn't collapse "what did the vessel last report"
 * and "how much do we trust that report is still true" into one function).
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

export function statusBucket(navStatusCode: number | null): StatusBucket {
  if (navStatusCode == null) return "unknown";
  return CODE_TO_BUCKET[navStatusCode] ?? "unknown";
}
