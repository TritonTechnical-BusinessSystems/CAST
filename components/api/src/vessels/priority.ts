/**
 * AIS monitor priority engine (INIT-0012 §3.6) — decides which ≤50 vessels
 * get the dedicated real-time subscription (Tier 1) vs. the rotated
 * best-effort one (Tier 2), out of a followed set that can be much larger
 * than the 50-per-subscription cap aisstream imposes.
 *
 * Pure and I/O-free by design: the caller resolves CW data (open tickets),
 * settings (pins/excludes), and the position cache (last-known nav status);
 * this module only scores and sorts. Keeps it directly unit-testable and
 * decouples it from the CW client / WS listener lifecycles.
 */
import { checkMmsi } from "./identifiers";
import type { VesselCompany } from "../connectwise/client";

/** The subscription cap aisstream imposes per WebSocket connection. */
export const TIER1_CAP = 50;

export interface LastKnown {
  /** A friendly nav-status label (e.g. "underway"); only "underway" affects priority. */
  navStatus?: string;
  lastSeenAt?: string;
}

export interface PrioritizeInput {
  /** The followed set, already filtered by the Tracking Config rule. */
  candidates: VesselCompany[];
  /** Company ids with an open ticket on a selected board (auto-promote). */
  openTicketCompanyIds: Set<string>;
  /** Manually pinned company ids — always-follow, outranks everything else. */
  pinned: Set<string>;
  /** Manually excluded company ids — never-follow, regardless of any signal. */
  excluded: Set<string>;
  /**
   * Company ids with no resolved Vessel Site (a CW site named "Vessel...") —
   * hard requirement, same tier as a missing MMSI: no site means nowhere to
   * write the result, so there's no point tracking it. Resolved separately
   * (`vessels/siteResolution.ts`, `POST /api/tracking/sites/resolve`) — this
   * only reads the cache, so pass whichever companies are currently uncached.
   */
  noVesselSite: Set<string>;
  /** Latest known position/status per MMSI, from the monitor's cache (may be empty pre-bootstrap). */
  lastKnownByMmsi?: Record<string, LastKnown>;
}

export type ExclusionReason = "no-valid-mmsi" | "no-vessel-site" | "manually-excluded";

export interface PrioritizeResult {
  /** ≤50 — the dedicated always-on subscription. */
  tier1: VesselCompany[];
  /** The rest of the trackable set — the rotated subscription. */
  tier2: VesselCompany[];
  /** Excluded from AIS tracking entirely. */
  excluded: { vessel: VesselCompany; reason: ExclusionReason }[];
}

interface Scored {
  vessel: VesselCompany;
  pinned: boolean;
  hasOpenTicket: boolean;
  underway: boolean;
}

/** Higher is better. Pinned > open-ticket > neither; underway breaks ties within a group. */
function rank(s: Scored): number {
  let n = 0;
  if (s.hasOpenTicket) n += 1;
  if (s.underway) n += 0.5; // tiebreaker only — never outranks a whole tier on its own
  if (s.pinned) n += 10; // always above any non-pinned combination
  return n;
}

export function prioritizeVessels(input: PrioritizeInput): PrioritizeResult {
  const { candidates, openTicketCompanyIds, pinned, excluded, noVesselSite, lastKnownByMmsi = {} } = input;

  const trackable: Scored[] = [];
  const excludedOut: PrioritizeResult["excluded"] = [];

  for (const v of candidates) {
    if (excluded.has(v.id)) {
      excludedOut.push({ vessel: v, reason: "manually-excluded" });
      continue;
    }
    // Hard requirement (INIT-0015): no valid MMSI means aisstream can't
    // subscribe to it regardless of any other signal — pins included.
    const mmsiCheck = checkMmsi(v.mmsi);
    if (!mmsiCheck.valid || !mmsiCheck.normalized) {
      excludedOut.push({ vessel: v, reason: "no-valid-mmsi" });
      continue;
    }
    // Hard requirement: no resolved Vessel Site means nowhere to write the
    // result — see the field doc above.
    if (noVesselSite.has(v.id)) {
      excludedOut.push({ vessel: v, reason: "no-vessel-site" });
      continue;
    }
    trackable.push({
      vessel: v,
      pinned: pinned.has(v.id),
      hasOpenTicket: openTicketCompanyIds.has(v.id),
      underway: lastKnownByMmsi[mmsiCheck.normalized]?.navStatus === "underway",
    });
  }

  // Stable, deterministic order: rank descending, then vessel name — so the
  // Tier 1 set doesn't reshuffle (and force needless resubscribes) between
  // runs when nothing meaningfully changed.
  trackable.sort((a, b) => rank(b) - rank(a) || a.vessel.vesselName.localeCompare(b.vessel.vesselName));

  return {
    tier1: trackable.slice(0, TIER1_CAP).map((s) => s.vessel),
    tier2: trackable.slice(TIER1_CAP).map((s) => s.vessel),
    excluded: excludedOut,
  };
}
