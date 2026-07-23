/**
 * System Health aggregation (INIT-0016). Probes each integration with a short
 * timeout and graceful degrade (the LC pattern), so the page always renders.
 */
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { config, adConfigured, aisstreamConfigured } from "../config";
import { resolveCwCreds } from "../connectwise/creds";
import { getSystemInfo } from "../connectwise/manageClient";

const router = Router();
const BUILD = process.env.CAST_BUILD ?? "dev";
const VERSION = process.env.CAST_VERSION ?? "0.1.0.0";

router.get("/full", requireAuth, async (_req, res) => {
  const connectwise = resolveCwCreds().creds
    ? await getSystemInfo()
        .then((i) => ({ state: "ok" as const, detail: `Connected — CW ${i.version}` }))
        .catch((e) => ({ state: "down" as const, detail: e instanceof Error ? e.message : "unreachable" }))
    : { state: "warn" as const, detail: "Not configured" };

  const aisstream = aisstreamConfigured()
    ? { state: "idle" as const, detail: "Key configured; monitor not yet running (INIT-0012)" }
    : { state: "warn" as const, detail: "No API key" };

  const activeDirectory = adConfigured()
    ? { state: "idle" as const, detail: "LDAPS configured" }
    : { state: "warn" as const, detail: "Not configured — local login only" };

  const sync = { state: "idle" as const, detail: `Scheduled ${config.vesselSyncCron} (stub — INIT-0012)` };

  res.json({
    app: { version: VERSION, build: BUILD, env: config.nodeEnv },
    integrations: { connectwise, aisstream, activeDirectory },
    sync,
    cwWrites: config.cwWritesEnabled,
  });
});

export default router;
