/**
 * Vessel Location Updating API (INIT-0012). Illustrative stub data for now —
 * real data comes from the scheduled sync (CW company IMO custom field →
 * marine-traffic lookup → Target Location address update).
 */
import { Router } from "express";
import { requireAuth } from "../middleware/auth";

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

router.get("/", requireAuth, (_req, res) => {
  res.json({ vessels });
});

router.post("/sync", requireAuth, (_req, res) => {
  // TODO(INIT-0012): enqueue the real sync run.
  res.json({ ok: true, queued: vessels.length });
});

export default router;
