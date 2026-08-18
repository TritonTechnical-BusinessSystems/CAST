/**
 * Vessel Tracking Configuration (INIT-0015). Options are read live from CW;
 * the rule is persisted; preview evaluates the rule against the tracked set
 * and runs the AIS monitor's priority split (INIT-0012 §3.6).
 *
 * DECIDED (2026-08-11, user): "Trackable Vessel" = Tracked Vessel (matches
 * Status + Identifiers) with a valid MMSI AND a resolved Vessel Site — both
 * hard requirements, checked in prioritizeVessels. Among Trackable Vessels,
 * an open Project in a selected status unconditionally outranks an open
 * ticket on a selected board (ties broken by most-recent activity within
 * each group); a Trackable Vessel with neither gets NO AIS coverage at all,
 * not even Tier 2 — only vessels with real, current business engagement are
 * worth tracking. NO MANUAL OVERRIDE of any kind — "pin" was rejected first
 * (arbitrary per-person promotion isn't a fair, formula-driven ranking),
 * then "exclude" too, same principle: to stop tracking a vessel, remove its
 * MMSI in ConnectWise (already a hard requirement) rather than a CAST-side
 * toggle.
 */
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import {
  tierRefreshMinutes,
  setTierRefreshMinutes,
  vesselSiteWriteAllowlist,
  setVesselSiteWriteAllowlist,
  isVesselSiteWriteAllowed,
  type VesselSiteWriteAllowlist,
} from "../config";
import { getSetting, setSetting } from "../store/secretStore";
import { listCompanyStatuses, listServiceBoards, listProjectStatuses } from "../connectwise/manageClient";
import { getCwClient } from "../connectwise/client";
import type { VesselCompany } from "../connectwise/client";
import { checkImo, checkMmsi } from "../vessels/identifiers";
import { prioritizeVessels } from "../vessels/priority";
import { resolveVesselSite } from "../vessels/siteResolution";
import { formatSiteUpdate } from "../vessels/siteWriter";
import { getPosition, listPositions } from "../vessels/positionStore";
import { statusBucket } from "../vessels/navStatus";
import type { LastKnown } from "../vessels/priority";

interface Rule {
  statuses: string[];
  boards: string[];
  projectStatuses: string[];
  requireImo: boolean;
  requireMmsi: boolean;
  /** If a matched client has no active "Vessel..." site, create one (isCwWritesEnabled()-gated) instead of leaving it excluded. Opt-in — off by default. */
  autoCreateVesselSite: boolean;
}
const DEFAULT_RULE: Rule = {
  statuses: [],
  boards: [],
  projectStatuses: [],
  requireImo: false,
  requireMmsi: true,
  autoCreateVesselSite: false,
};

/** companyId -> resolved Vessel Site id, or null if none resolvable. */
type SiteMap = Record<string, string | null>;

const router = Router();

router.get("/options", requireAuth, async (_req, res) => {
  try {
    const [statuses, boards, projectStatuses] = await Promise.all([
      listCompanyStatuses(),
      listServiceBoards(),
      listProjectStatuses(),
    ]);
    res.json({ statuses, boards, projectStatuses });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "ConnectWise query failed" });
  }
});

/**
 * Merges the stored rule (if any) over DEFAULT_RULE rather than trusting it
 * as a complete Rule — a rule persisted before a schema addition (e.g.
 * `projectStatuses`/`autoCreateVesselSite`, both added 2026-08-11) is
 * missing those fields, and every caller here assumes the full shape
 * (`rule.projectStatuses.length` etc.). Without this, an old stored rule
 * crashes the tier-refresh job and blanks the Tracking Config page (found
 * live post-deploy — `TypeError: Cannot read properties of undefined`).
 */
export function getStoredRule(): Rule {
  return { ...DEFAULT_RULE, ...(getSetting<Partial<Rule>>("tracking.rule") ?? {}) };
}

router.get("/config", requireAuth, (_req, res) => {
  res.json(getStoredRule());
});

router.post("/config", requirePermission("tracking.write"), (req, res) => {
  setSetting("tracking.rule", { ...DEFAULT_RULE, ...(req.body as Partial<Rule>) });
  res.json({ ok: true });
});

router.get("/refresh-interval", requireAuth, (_req, res) => {
  res.json({ minutes: tierRefreshMinutes() });
});

router.put("/refresh-interval", requirePermission("tracking.write"), (req, res) => {
  const { minutes } = (req.body ?? {}) as { minutes?: unknown };
  if (typeof minutes !== "number" || !(minutes > 0)) {
    return res.status(400).json({ error: "minutes must be a positive number" });
  }
  setTierRefreshMinutes(minutes);
  res.json({ ok: true, minutes: tierRefreshMinutes() });
});

/** The last scheduled tier-refresh result (jobs/tierRefresh.ts) — for display, not recomputed on read. */
router.get("/current-split", requireAuth, (_req, res) => {
  res.json(getSetting("tracking.currentSplit") ?? null);
});

/** Controlled-rollout gate for Vessel Site writes (INIT-0012, 2026-08-18) — `"all"` or a list of allowed MMSIs. Default (unset) is an empty list: writes to nobody until explicitly opted in. */
router.get("/vessel-site-write-allowlist", requireAuth, (_req, res) => {
  res.json({ allowlist: vesselSiteWriteAllowlist() });
});

router.put("/vessel-site-write-allowlist", requirePermission("tracking.write"), (req, res) => {
  const { allowlist } = (req.body ?? {}) as { allowlist?: unknown };
  if (allowlist !== "all" && !(Array.isArray(allowlist) && allowlist.every((m) => typeof m === "string"))) {
    return res.status(400).json({ error: 'allowlist must be "all" or an array of MMSI strings' });
  }
  setVesselSiteWriteAllowlist(allowlist as VesselSiteWriteAllowlist);
  res.json({ ok: true, allowlist: vesselSiteWriteAllowlist() });
});

function toList(vessels: { vesselName: string; companyName: string }[]) {
  return vessels.map((v) => ({ vesselName: v.vesselName, companyName: v.companyName }));
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
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Fills in any missing Vessel Site for the currently-matched set. "Missing"
 * means no cached entry at all, or a cached `null` (previously not
 * resolvable) — a company with a real cached site id is trusted purely
 * locally and never touches CW here (renames don't invalidate it; only a
 * failed write does, once the AIS write path exists — see
 * knowledge/architecture/vessel-location-updating-aisstream.md §3.6).
 *
 * When no active "Vessel..." site exists for a company AND
 * `rule.autoCreateVesselSite` is on, this CREATES one
 * (`CwClient.createVesselSite`, also isCwWritesEnabled()-gated) instead of
 * leaving the vessel excluded indefinitely — a company only ever fails to
 * resolve for one cycle, not permanently. With the option off, a company
 * with no site just stays unresolved (detect-only), same as before.
 *
 * Creation is independently gated on a valid MMSI regardless of whether
 * `rule.requireMmsi` is checked — the setting's own label promises "any
 * client with an MMSI," and that must hold even if an operator has
 * temporarily unchecked "Require MMSI" to audit vessels missing one.
 *
 * ALSO gated by `isVesselSiteWriteAllowed()` (2026-08-18, security review) —
 * creation is a real CW write, same category as `updateVesselSite`, and
 * without this check it would bypass the Vessel Site Write Allowlist
 * entirely: `autoCreateVesselSite` runs on this same scheduled cycle, so a
 * company with no resolvable site would get a brand-new "Vessel" site
 * created on the very next tier-refresh regardless of whether that
 * company's MMSI was ever explicitly allowlisted — exactly the "everything
 * at once" outcome the allowlist exists to prevent. Confirmed live in
 * production before this fix: `autoCreateVesselSite` is `true` today, so
 * this was not a theoretical gap.
 *
 * Called only from the scheduled tier-refresh job, never from the
 * interactive `/preview` — site creation is a real CW write and shouldn't be
 * a side effect of someone adjusting filters in the UI.
 */
export async function reconcileVesselSites(rule: Rule): Promise<void> {
  const cw = getCwClient();
  const matched = matchRule(await cw.listTrackedVessels(), rule);
  const siteMap = getSetting<SiteMap>("tracking.siteMap") ?? {};
  const unresolved = matched.filter((v) => !siteMap[v.id]);
  if (unresolved.length === 0) return;

  await mapWithConcurrency(unresolved, 8, async (v) => {
    try {
      const sites = await cw.getCompanySites(v.id);
      const r = resolveVesselSite(sites, siteMap[v.id] ?? null);
      if (r.siteId) {
        siteMap[v.id] = r.siteId;
      } else {
        const mmsiCheck = checkMmsi(v.mmsi);
        if (rule.autoCreateVesselSite && mmsiCheck.valid && mmsiCheck.normalized && isVesselSiteWriteAllowed(mmsiCheck.normalized)) {
          siteMap[v.id] = (await cw.createVesselSite(v.id)).id;
        }
      }
      // else: leave unresolved — no site, and either auto-create is off or the vessel has no valid MMSI.
    } catch (err) {
      console.error(`[tracking] Vessel Site reconcile failed for company ${v.id}:`, err);
      // Left unresolved — retried next cycle.
    }
  });

  setSetting("tracking.siteMap", siteMap);
}

/** companyId -> the site fields last actually written — skips a redundant CW PATCH when nothing's changed. `lastAisUpdateText` legitimately changes on every fresh AIS message even when the displayed status text doesn't, by design — that field exists specifically to track true freshness. */
type LastSiteWrite = Record<string, { name: string; addressLine1?: string; timeZoneSetupId?: number; lastAisUpdateText: string }>;

/**
 * Writes each Trackable Vessel's current status onto its resolved Vessel
 * Site (`formatSiteUpdate` in `vessels/siteWriter.ts` — name = friendly
 * status + place/destination, addressLine1 = raw coordinates; decided
 * 2026-08-11, user). Only vessels currently in Tier 1 or Tier 2 ever have
 * position data at all (nothing else has an AIS subscription), so this
 * naturally only writes for vessels actually being monitored.
 *
 * Diffs against the last-written value per site (`tracking.lastSiteWrite`)
 * and skips the CW call entirely when nothing changed — this runs every
 * tier-refresh cycle, and most cycles nothing will have changed for most
 * vessels. `formatSiteUpdate` returns null for stale/no-data vessels, which
 * are left untouched (see that file's header for why).
 *
 * Gated a second time by `isVesselSiteWriteAllowed()` (`config.ts`), on top
 * of the existing `isCwWritesEnabled()` check inside `updateVesselSite`
 * itself — a controlled-rollout allowlist so real writes can start with a
 * handful of MMSIs rather than every Tier 1/2 vessel at once.
 *
 * Called only from the scheduled tier-refresh job — a real CW write,
 * same as reconcileVesselSites, shouldn't be a side effect of `/preview`.
 */
export async function writeVesselSites(split: { tier1: { id: string; mmsi: string }[]; tier2: { id: string; mmsi: string }[] }): Promise<void> {
  const cw = getCwClient();
  const siteMap = getSetting<SiteMap>("tracking.siteMap") ?? {};
  const lastWrite = getSetting<LastSiteWrite>("tracking.lastSiteWrite") ?? {};
  const vessels = [...split.tier1, ...split.tier2];

  await mapWithConcurrency(vessels, 8, async (v) => {
    const siteId = siteMap[v.id];
    if (!siteId) return;
    if (!isVesselSiteWriteAllowed(v.mmsi)) return;
    const update = formatSiteUpdate(getPosition(v.mmsi));
    if (!update) return;
    const prev = lastWrite[siteId];
    if (
      prev &&
      prev.name === update.name &&
      prev.addressLine1 === update.addressLine1 &&
      prev.timeZoneSetupId === update.timeZoneSetupId &&
      prev.lastAisUpdateText === update.lastAisUpdateText
    ) {
      return;
    }

    try {
      await cw.updateVesselSite(v.id, siteId, update);
      lastWrite[siteId] = update;
    } catch (err) {
      console.error(`[tracking] Vessel Site write failed for company ${v.id}:`, err);
    }
  });

  setSetting("tracking.lastSiteWrite", lastWrite);
}

/** Shared by the live preview and the scheduled tier-refresh job. */
export async function computeSplit(rule: Rule) {
  const cw = getCwClient();
  const [vessels, siteMap] = await Promise.all([
    cw.listTrackedVessels(),
    Promise.resolve(getSetting<SiteMap>("tracking.siteMap") ?? {}),
  ]);
  const matched = matchRule(vessels, rule);

  // Project/ticket activity only feeds ranking, not Tracked-Vessel
  // membership — see file header.
  const [projectActivityByCompanyId, ticketActivityByCompanyId] = await Promise.all([
    rule.projectStatuses.length ? cw.listOpenProjectActivity(rule.projectStatuses) : Promise.resolve(new Map<string, string>()),
    rule.boards.length ? cw.listOpenTicketActivity(rule.boards) : Promise.resolve(new Map<string, string>()),
  ]);

  // Vessel Site check is against the CACHED map only, purely local — never a
  // live CW call from this path. See reconcileVesselSites() (called only
  // from the scheduled job) for what actually populates the cache.
  const noVesselSite = new Set(matched.filter((v) => !siteMap[v.id]).map((v) => v.id));

  // Purely local — the position cache is upserted continuously by the WS
  // listener (vessels/aisListener.ts), never queried live here.
  const lastKnownByMmsi: Record<string, LastKnown> = {};
  for (const p of listPositions()) {
    lastKnownByMmsi[p.mmsi] = { navStatus: statusBucket(p.navStatusCode), lastSeenAt: p.lastSeenAt };
  }

  const split = prioritizeVessels({
    candidates: matched,
    projectActivityByCompanyId,
    ticketActivityByCompanyId,
    noVesselSite,
    lastKnownByMmsi,
  });

  return { matched, split };
}

router.post("/preview", requireAuth, async (req, res) => {
  const rule: Rule = { ...DEFAULT_RULE, ...(req.body as Partial<Rule>) };
  try {
    const { matched, split } = await computeSplit(rule);
    res.json({
      matched: matched.length,
      tier1: { count: split.tier1.length, vessels: toList(split.tier1) },
      tier2: { count: split.tier2.length, vessels: toList(split.tier2) },
      excludedNoMmsi: split.excluded.filter((e) => e.reason === "no-valid-mmsi").length,
      excludedNoSite: split.excluded.filter((e) => e.reason === "no-vessel-site").length,
      excludedNoEngagement: split.excluded.filter((e) => e.reason === "no-active-engagement").length,
    });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Preview failed" });
  }
});

export default router;
