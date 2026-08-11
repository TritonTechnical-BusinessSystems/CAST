/**
 * Scheduled AIS-monitor Tier 1/2 refresh (INIT-0012 §3.6). Recomputes the
 * priority split against the SAVED tracking rule and persists it
 * (`tracking.currentSplit`) so the (not-yet-built) WS listener has a ready
 * MMSI list to subscribe to without recomputing on its own.
 *
 * Self-rescheduling `setTimeout`, not `node-cron` — the interval is
 * runtime-adjustable (`setTierRefreshMinutes`, `PUT /api/tracking/config`'s
 * sibling), and re-reading it fresh before each reschedule means a change
 * takes effect on the next cycle without a restart. Also runs
 * `reconcileVesselSites` first each cycle — the one place Vessel Site
 * lookups/creation happen; everything else (including `computeSplit` right
 * below) reads the resulting cache purely locally.
 */
import { tierRefreshMinutes } from "../config";
import { setSetting } from "../store/secretStore";
import { computeSplit, reconcileVesselSites, getStoredRule } from "../routes/tracking";

export interface CurrentSplit {
  computedAt: string;
  tier1: { id: string; vesselName: string; companyName: string; mmsi: string }[];
  tier2: { id: string; vesselName: string; companyName: string; mmsi: string }[];
}

let timer: ReturnType<typeof setTimeout> | null = null;

export function startTierRefresh(): void {
  scheduleNext();
  console.log(`[tier-refresh] started — every ${tierRefreshMinutes()}m (runtime-adjustable, see tracking.refreshIntervalMinutes)`);
}

export function stopTierRefresh(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function scheduleNext(): void {
  const minutes = tierRefreshMinutes(); // re-read fresh — a mid-run change takes effect next cycle
  timer = setTimeout(() => {
    runTierRefresh()
      .catch((err) => console.error("[tier-refresh] run failed:", err))
      .finally(scheduleNext);
  }, minutes * 60_000);
}

async function runTierRefresh(): Promise<void> {
  const rule = getStoredRule();
  await reconcileVesselSites(rule);
  const { split } = await computeSplit(rule);
  const toEntry = (v: { id: string; vesselName: string; companyName: string; mmsi: string | null }) => ({
    id: v.id,
    vesselName: v.vesselName,
    companyName: v.companyName,
    mmsi: v.mmsi ?? "", // trackable vessels always have a valid MMSI by this point (hard requirement)
  });
  const result: CurrentSplit = {
    computedAt: new Date().toISOString(),
    tier1: split.tier1.map(toEntry),
    tier2: split.tier2.map(toEntry),
  };
  setSetting("tracking.currentSplit", result);
  console.log(`[tier-refresh] tier1=${result.tier1.length} tier2=${result.tier2.length}`);
}
