/**
 * Vessel Tracking Configuration (INIT-0015). Options are read live from CW;
 * the rule is persisted; preview evaluates the rule against the tracked set
 * and runs the AIS monitor's priority split (INIT-0012 §3.6).
 *
 * DECIDED (2026-08-11, user): the "boards" group does NOT gate followed-set
 * MEMBERSHIP — membership is Status + Identifiers only (AND'd), matching
 * this file's original filter. Boards only feeds the AIS-monitor's Tier-1
 * promotion signal (prioritizeVessels), so a vessel between engagements
 * still gets baseline Tier-2 coverage instead of dropping out of tracking
 * entirely. (This reverses the page's older "AND across all groups" banner
 * copy — see TrackingConfig.tsx.)
 */
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { getSetting, setSetting } from "../store/secretStore";
import { listCompanyStatuses, listServiceBoards } from "../connectwise/manageClient";
import { getCwClient } from "../connectwise/client";
import type { VesselCompany } from "../connectwise/client";
import { checkImo, checkMmsi } from "../vessels/identifiers";
import { prioritizeVessels } from "../vessels/priority";
import { resolveVesselSite, type SiteResolutionReason } from "../vessels/siteResolution";

interface Rule { statuses: string[]; boards: string[]; requireImo: boolean; requireMmsi: boolean; }
const DEFAULT_RULE: Rule = { statuses: [], boards: [], requireImo: false, requireMmsi: true };

interface Pins { pinned: string[]; excluded: string[]; }
const DEFAULT_PINS: Pins = { pinned: [], excluded: [] };

/** companyId -> resolved Vessel Site id, or null if none resolvable. */
type SiteMap = Record<string, string | null>;

const router = Router();

router.get("/options", requireAuth, async (_req, res) => {
  try {
    const [statuses, boards] = await Promise.all([listCompanyStatuses(), listServiceBoards()]);
    res.json({ statuses, boards });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "ConnectWise query failed" });
  }
});

router.get("/config", requireAuth, (_req, res) => {
  res.json(getSetting<Rule>("tracking.rule") ?? DEFAULT_RULE);
});

router.post("/config", requirePermission("tracking.write"), (req, res) => {
  setSetting("tracking.rule", req.body as Rule);
  res.json({ ok: true });
});

router.get("/pins", requireAuth, (_req, res) => {
  res.json(getSetting<Pins>("tracking.pins") ?? DEFAULT_PINS);
});

router.put("/pins", requirePermission("tracking.write"), (req, res) => {
  setSetting("tracking.pins", req.body as Pins);
  res.json({ ok: true });
});

function sample(vessels: { vesselName: string; companyName: string }[], n = 8) {
  return vessels.slice(0, n).map((v) => ({ vesselName: v.vesselName, companyName: v.companyName }));
}

function matchRule(vessels: VesselCompany[], rule: Rule): VesselCompany[] {
  return vessels.filter((v) => {
    if (rule.statuses.length && !rule.statuses.includes(v.status)) return false;
    if (rule.requireImo && !checkImo(v.imo).valid) return false;
    if (rule.requireMmsi && !checkMmsi(v.mmsi).valid) return false;
    return true;
  });
}

/** Runs `fn` over `items` with at most `limit` in flight — CW's API has no
 *  published bulk-sites endpoint, so resolving Vessel Sites is one call per
 *  company; unbounded parallelism would hammer it, fully sequential would be
 *  slow for a few hundred companies. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

router.post("/preview", requireAuth, async (req, res) => {
  const rule = (req.body ?? DEFAULT_RULE) as Rule;
  try {
    const [vessels, pins, siteMap] = await Promise.all([
      getCwClient().listTrackedVessels(),
      Promise.resolve(getSetting<Pins>("tracking.pins") ?? DEFAULT_PINS),
      Promise.resolve(getSetting<SiteMap>("tracking.siteMap") ?? {}),
    ]);
    const matched = matchRule(vessels, rule);

    // Boards only feeds Tier-1 promotion (see file header) — not membership.
    const openTicketCompanyIds = rule.boards.length
      ? await getCwClient().listOpenTicketCompanyIds(rule.boards)
      : new Set<string>();

    // Vessel Site check is against the CACHED map only (no live CW calls
    // here — this endpoint fires on every keystroke while editing the rule;
    // resolving sites live would mean one CW call per candidate per preview.
    // The cache is populated/refreshed by POST /sites/resolve instead.
    const noVesselSite = new Set(matched.filter((v) => !siteMap[v.id]).map((v) => v.id));

    const split = prioritizeVessels({
      candidates: matched,
      openTicketCompanyIds,
      pinned: new Set(pins.pinned),
      excluded: new Set(pins.excluded),
      noVesselSite,
      // No position cache yet (the AIS monitor listener isn't built) — the
      // "underway" tiebreaker is a no-op until then, everything else applies.
    });

    res.json({
      matched: matched.length,
      tier1: { count: split.tier1.length, sample: sample(split.tier1) },
      tier2: { count: split.tier2.length, sample: sample(split.tier2) },
      excludedNoMmsi: split.excluded.filter((e) => e.reason === "no-valid-mmsi").length,
      excludedNoSite: split.excluded.filter((e) => e.reason === "no-vessel-site").length,
      excludedManually: split.excluded.filter((e) => e.reason === "manually-excluded").length,
    });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Preview failed" });
  }
});

/**
 * Resolve each currently-matched vessel's Vessel Site (a CW site whose name
 * starts with "Vessel") and cache its id — see vessels/siteResolution.ts for
 * the state machine. Explicit/manual for now (not scheduled) since the rest
 * of the AIS monitor's periodic-refresh machinery doesn't exist yet either.
 */
router.post("/sites/resolve", requirePermission("tracking.write"), async (_req, res) => {
  try {
    const rule = getSetting<Rule>("tracking.rule") ?? DEFAULT_RULE;
    const cw = getCwClient();
    const matched = matchRule(await cw.listTrackedVessels(), rule);
    const siteMap = getSetting<SiteMap>("tracking.siteMap") ?? {};

    const summary: Record<SiteResolutionReason, number> = { kept: 0, resolved: 0, cleared: 0, none: 0 };
    const ambiguous: { vesselName: string; companyName: string }[] = [];

    await mapWithConcurrency(matched, 8, async (v) => {
      const sites = await cw.getCompanySites(v.id);
      const r = resolveVesselSite(sites, siteMap[v.id] ?? null);
      siteMap[v.id] = r.siteId;
      summary[r.reason]++;
      if (r.ambiguous) ambiguous.push({ vesselName: v.vesselName, companyName: v.companyName });
    });

    setSetting("tracking.siteMap", siteMap);
    res.json({ checked: matched.length, ...summary, ambiguous });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Site resolution failed" });
  }
});

export default router;
