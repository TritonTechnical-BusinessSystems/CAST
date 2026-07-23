/**
 * Vessel Tracking Configuration (INIT-0015). Options are read live from CW;
 * the rule is persisted; preview evaluates the rule against the tracked set.
 *
 * NOTE: the board/open-ticket criterion is not yet applied in preview — that
 * needs the open-tickets-by-board query (TODO INIT-0015). Status + IMO/MMSI are.
 */
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getSetting, setSetting } from "../store/secretStore";
import { listCompanyStatuses, listServiceBoards } from "../connectwise/manageClient";
import { getCwClient } from "../connectwise/client";
import { checkImo, checkMmsi } from "../vessels/identifiers";

interface Rule { statuses: string[]; boards: string[]; requireImo: boolean; requireMmsi: boolean; }
const DEFAULT_RULE: Rule = { statuses: [], boards: [], requireImo: false, requireMmsi: true };

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

router.post("/config", requireAuth, (req, res) => {
  setSetting("tracking.rule", req.body as Rule);
  res.json({ ok: true });
});

router.post("/preview", requireAuth, async (req, res) => {
  const rule = (req.body ?? DEFAULT_RULE) as Rule;
  try {
    const vessels = await getCwClient().listTrackedVessels();
    const matched = vessels.filter((v) => {
      if (rule.statuses.length && !rule.statuses.includes(v.status)) return false;
      if (rule.requireImo && !checkImo(v.imo).valid) return false;
      if (rule.requireMmsi && !checkMmsi(v.mmsi).valid) return false;
      return true;
    });
    res.json({
      count: matched.length,
      sample: matched.slice(0, 8).map((v) => ({ vesselName: v.vesselName, companyName: v.companyName })),
    });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Preview failed" });
  }
});

export default router;
