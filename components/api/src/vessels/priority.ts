/**
 * AIS monitor priority engine (INIT-0012 §3.6) — decides which ≤50 vessels
 * get the dedicated real-time subscription (Tier 1) vs. the rotated
 * best-effort one (Tier 2), out of a followed set that can be much larger
 * than the 50-per-subscription cap aisstream imposes.
 *
 * DECIDED (2026-08-11, user): strict priority groups, not additive scoring —
 * every vessel with an open Project in a selected status outranks every
 * vessel with only an open ticket, no exceptions; within each group, most
 * recent activity wins. A Trackable Vessel in neither group gets NO AIS
 * coverage at all (not even Tier 2) — only vessels with real, current
 * business engagement are worth the resource. NO MANUAL OVERRIDE of any kind
 * — the user rejected "pin" (arbitrary per-person promotion isn't a fair,
 * formula-driven ranking) and then "exclude" too, on the same principle: if
 * a vessel shouldn't be tracked, the fix is to remove its MMSI in
 * ConnectWise (already a hard requirement below), not a CAST-side toggle.
 * Every exclusion this module produces is a formula outcome, never a
 * standing manual decision.
 *
 * Pure and I/O-free by design: the caller resolves CW data (open tickets and
 * projects, each as a company→last-activity map) and the position cache;
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
  /** Company id -> ISO timestamp of its most recent open-Project activity (selected statuses only). */
  projectActivityByCompanyId: Map<string, string>;
  /** Company id -> ISO timestamp of its most recent open-ticket activity (selected boards only). */
  ticketActivityByCompanyId: Map<string, string>;
  /**
   * Company ids with no resolved Vessel Site (a CW site named "Vessel...") —
   * hard requirement, same tier as a missing MMSI: no site means nowhere to
   * write the result, so there's no point tracking it. Resolved separately
   * (`vessels/siteResolution.ts`, `reconcileVesselSites()` in
   * `routes/tracking.ts`) — this only reads the local cache, so pass
   * whichever companies are currently uncached.
   */
  noVesselSite: Set<string>;
  /** Latest known position/status per MMSI, from the monitor's cache (may be empty pre-bootstrap). */
  lastKnownByMmsi?: Record<string, LastKnown>;
}

export type ExclusionReason = "no-valid-mmsi" | "no-vessel-site" | "no-active-engagement";

export interface PrioritizeResult {
  /** ≤50 — the dedicated always-on subscription. */
  tier1: VesselCompany[];
  /** The rest of the (project-or-ticket) engaged set — the rotated subscription. */
  tier2: VesselCompany[];
  /** Excluded from AIS tracking entirely. */
  excluded: { vessel: VesselCompany; reason: ExclusionReason }[];
}

type Group = "project" | "ticket";

interface Scored {
  vessel: VesselCompany;
  group: Group;
  /** Epoch ms of the group's activity signal — higher (more recent) ranks first within the group. */
  activity: number;
  underway: boolean;
}

/** Project beats ticket, unconditionally; within a group, more recent activity wins;
 *  "underway" and vessel name are tiebreakers for the (now rare) exact-timestamp tie. */
function compare(a: Scored, b: Scored): number {
  if (a.group !== b.group) return a.group === "project" ? -1 : 1;
  if (a.activity !== b.activity) return b.activity - a.activity;
  if (a.underway !== b.underway) return a.underway ? -1 : 1;
  return a.vessel.vesselName.localeCompare(b.vessel.vesselName);
}

export function prioritizeVessels(input: PrioritizeInput): PrioritizeResult {
  const { candidates, projectActivityByCompanyId, ticketActivityByCompanyId, noVesselSite, lastKnownByMmsi = {} } = input;

  const scored: Scored[] = [];
  const excludedOut: PrioritizeResult["excluded"] = [];

  for (const v of candidates) {
    // Hard requirement (INIT-0015): no valid MMSI means aisstream can't
    // subscribe to it regardless of any other signal.
    const mmsiCheck = checkMmsi(v.mmsi);
    if (!mmsiCheck.valid || !mmsiCheck.normalized) {
      excludedOut.push({ vessel: v, reason: "no-valid-mmsi" });
      continue;
    }
    // Hard requirement: no resolved Vessel Site means nowhere to write the result.
    if (noVesselSite.has(v.id)) {
      excludedOut.push({ vessel: v, reason: "no-vessel-site" });
      continue;
    }

    const projectActivity = projectActivityByCompanyId.get(v.id);
    const ticketActivity = ticketActivityByCompanyId.get(v.id);
    const group: Group | null = projectActivity ? "project" : ticketActivity ? "ticket" : null;
    if (!group) {
      // Trackable, but no current business engagement — no AIS coverage at
      // all (2026-08-11 decision), not even Tier 2.
      excludedOut.push({ vessel: v, reason: "no-active-engagement" });
      continue;
    }

    scored.push({
      vessel: v,
      group,
      activity: new Date((group === "project" ? projectActivity : ticketActivity)!).getTime(),
      underway: lastKnownByMmsi[mmsiCheck.normalized]?.navStatus === "underway",
    });
  }

  scored.sort(compare);

  return {
    tier1: scored.slice(0, TIER1_CAP).map((s) => s.vessel),
    tier2: scored.slice(TIER1_CAP).map((s) => s.vessel),
    excluded: excludedOut,
  };
}
