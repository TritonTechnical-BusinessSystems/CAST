/**
 * Geo Alerts config (INIT-0017) — define areas + the action to fire when a
 * tracked vessel enters one. Persisted; the aisstream monitor consumes it.
 * Reading is any authenticated user; editing needs tracking.write.
 */
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { getSetting, setSetting } from "../store/secretStore";
import { DEFAULT_GEO_CONFIG, type GeoAlertConfig } from "../vessels/geo";

const router = Router();
const KEY = "geo.alerts";

router.get("/", requireAuth, (_req, res) => {
  res.json(getSetting<GeoAlertConfig>(KEY) ?? DEFAULT_GEO_CONFIG);
});

router.put("/", requirePermission("tracking.write"), (req, res) => {
  setSetting(KEY, req.body as GeoAlertConfig);
  res.json({ ok: true });
});

export default router;
