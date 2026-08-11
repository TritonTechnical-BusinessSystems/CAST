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
import { checkImo, checkMmsi } from "../vessels/identifiers";
import { prioritizeVessels } from "../vessels/priority";

interface Rule { statuses: string[]; boards: string[]; requireImo: boolean; requireMmsi: boolean; }
const DEFAULT_RULE: Rule = { statuses: [], boards: [], requireImo: false, requireMmsi: true };

interface Pins { pinned: string[]; excluded: string[]; }
const DEFAULT_PINS: Pins = { pinned: [], excluded: [] };

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

router.post("/preview", requireAuth, async (req, res) => {
  const rule = (req.body ?? DEFAULT_RULE) as Rule;
  try {
    const [vessels, pins] = await Promise.all([
      getCwClient().listTrackedVessels(),
      Promise.resolve(getSetting<Pins>("tracking.pins") ?? DEFAULT_PINS),
    ]);
    const matched = vessels.filter((v) => {
      if (rule.statuses.length && !rule.statuses.includes(v.status)) return false;
      if (rule.requireImo && !checkImo(v.imo).valid) return false;
      if (rule.requireMmsi && !checkMmsi(v.mmsi).valid) return false;
      return true;
    });

    // Boards only feeds Tier-1 promotion (see file header) — not membership.
    const openTicketCompanyIds = rule.boards.length
      ? await getCwClient().listOpenTicketCompanyIds(rule.boards)
      : new Set<string>();

    const split = prioritizeVessels({
      candidates: matched,
      openTicketCompanyIds,
      pinned: new Set(pins.pinned),
      excluded: new Set(pins.excluded),
      // No position cache yet (the AIS monitor listener isn't built) — the
      // "underway" tiebreaker is a no-op until then, everything else applies.
    });

    res.json({
      matched: matched.length,
      tier1: { count: split.tier1.length, sample: sample(split.tier1) },
      tier2: { count: split.tier2.length, sample: sample(split.tier2) },
      excludedNoMmsi: split.excluded.filter((e) => e.reason === "no-valid-mmsi").length,
      excludedManually: split.excluded.filter((e) => e.reason === "manually-excluded").length,
    });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Preview failed" });
  }
});

export default router;
