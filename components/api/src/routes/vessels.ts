/**
 * Vessel Location Updating API (INIT-0012). `vessels` below is illustrative
 * stub data pending the eligible-CW-status/rule decisions it was scaffolded
 * against; the routes below it (`/tracked`, `/positions`, `/history/:mmsi`)
 * are real, live AIS data — see each route's own comment.
 */
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { getPosition, listPositions, listHistory } from "../vessels/positionStore";
import { statusBucket } from "../vessels/navStatus";
import { formatSiteUpdate } from "../vessels/siteWriter";
import { getSetting } from "../store/secretStore";

interface Vessel {
  company: string;
  imo: string;
  vessel: string;
  status: "underway" | "moored" | "anchored" | "dry-docked" | "docked";
  position: string;
  target: string;
  lastSynced: string;
}

// Illustrative only — not real clients (INIT-0012 open: data source, eligible
// CW status, target-location rule).
const vessels: Vessel[] = [
  { company: "Aegean Star Shipping LLC", imo: "9456217", vessel: "MV Aegean Star", status: "underway", position: "24 nm SW of Gibraltar Strait", target: "Gibraltar Relay Office", lastSynced: "12 min ago" },
  { company: "Meridian Bulk Carriers", imo: "9317842", vessel: "MV Meridian Voyager", status: "docked", position: "Port of Rotterdam, NL", target: "Rotterdam Berth Office", lastSynced: "38 min ago" },
  { company: "Northgate Tanker Co.", imo: "9204471", vessel: "MV Northgate Pride", status: "moored", position: "Singapore Anchorage, SG", target: "Singapore Ops Site", lastSynced: "2 hr ago" },
];

const router = Router();

router.get("/", requirePermission("vessel.read"), (_req, res) => {
  res.json({ vessels });
});

// TODO(INIT-0012): currently a no-op stub — once this enqueues a real sync run,
// gate it on requirePermission("vessel.reconcile") like vesselIdentity.ts's
// equivalent write route, not bare requireAuth (flagged, not fixed, by the
// v0.10.0 security review — nothing to enforce yet since it does nothing).
router.post("/sync", requireAuth, (_req, res) => {
  res.json({ ok: true, queued: vessels.length });
});

/** Real, live AIS latest-position cache (INIT-0012) — for inspecting what the WS listener is actually receiving, independent of the illustrative stub data above. */
router.get("/positions", requirePermission("vessel.read"), (_req, res) => {
  res.json({ positions: listPositions() });
});

interface SplitEntry {
  id: string;
  vesselName: string;
  companyName: string;
  mmsi: string;
}

/**
 * Every vessel with real-time or rotating AIS coverage right now (Monitoring
 * Tier 1/2 — `tracking.currentSplit`, last computed by `jobs/tierRefresh.ts`)
 * plus its latest known position, formatted through the SAME `formatSiteUpdate`
 * used for the real ConnectWise write — so what's shown here is exactly what
 * would be written if CW writes were enabled, not a separate description of
 * it. A Tracked Vessel with no Monitoring Tier gets zero AIS coverage under
 * the priority engine (`knowledge/conventions/naming-lexicon.md`), so it can
 * never have position data — deliberately excluded here rather than padding
 * the list with permanently-empty rows.
 */
router.get("/tracked", requirePermission("vessel.read"), (_req, res) => {
  const split = getSetting<{ tier1: SplitEntry[]; tier2: SplitEntry[] }>("tracking.currentSplit");
  const entries = [
    ...(split?.tier1 ?? []).map((v) => ({ ...v, tier: 1 as const })),
    ...(split?.tier2 ?? []).map((v) => ({ ...v, tier: 2 as const })),
  ];

  const vessels = entries
    .map((v) => {
      const position = getPosition(v.mmsi);
      const update = position ? formatSiteUpdate(position) : null;
      return {
        id: v.id,
        vesselName: v.vesselName,
        companyName: v.companyName,
        mmsi: v.mmsi,
        tier: v.tier,
        navigationalStatus: position ? statusBucket(position.navStatusCode) : "unknown",
        summary: update?.name ?? null,
        addressLine1: update?.addressLine1 ?? null,
        lastSeenAt: position?.lastSeenAt ?? null,
        destination: position?.destination ?? null,
        etaIso: position?.etaIso ?? null,
      };
    })
    .sort((a, b) => a.vesselName.localeCompare(b.vesselName));

  res.json({ vessels });
});

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 200;

/** Most recent raw updates received for one vessel — the Vessel Location tree's expandable history (INIT-0033). Not formatted through formatSiteUpdate (that's for the single current row); raw facts per entry so a person can see exactly what arrived, in receipt order. */
router.get("/history/:mmsi", requirePermission("vessel.read"), (req, res) => {
  const { mmsi } = req.params;
  // MMSI is always exactly 9 digits (ITU-R M.1371) — bounded, not just numeric, so an oversized param can't reach the query layer.
  if (!/^\d{9}$/.test(mmsi)) return res.status(400).json({ error: "Invalid MMSI" });
  const limitParam = Number(req.query.limit);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), MAX_HISTORY_LIMIT) : DEFAULT_HISTORY_LIMIT;
  res.json({ history: listHistory(mmsi, limit) });
});

export default router;
