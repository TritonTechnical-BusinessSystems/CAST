/**
 * System Health aggregation (INIT-0016). Probes each integration with a short
 * timeout and graceful degrade (the LC pattern), so the page always renders.
 */
import { Router } from "express";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import { requireAuth } from "../middleware/auth";
import { config, adConfigured, aisstreamConfigured, isCwWritesEnabled } from "../config";
import { resolveCwCreds } from "../connectwise/creds";
import { getSystemInfo } from "../connectwise/manageClient";
import { getPackageManifest } from "../health/packages";
import { getContainers } from "../health/containers";
import { getAisStatus } from "../vessels/aisListener";
import { readEventLoopLag } from "../health/eventLoopLag";

const router = Router();

/** Package manifest + OSV.dev vulnerability check (cached 24h). */
router.get("/packages", requireAuth, async (_req, res) => {
  try {
    res.json({ packages: await getPackageManifest() });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Package scan failed" });
  }
});

/** Docker container inventory, via the read-only docker-socket-proxy. */
router.get("/containers", requireAuth, async (_req, res) => {
  try {
    res.json({ containers: await getContainers() });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Container query failed" });
  }
});
// CAST_VERSION/CAST_BUILD env vars were never actually set anywhere (not in
// docker-compose.yml, not in either Dockerfile) — this silently always
// reported the "dev"/"0.1.0.0" fallback in production, disagreeing with the
// rail footer's real __APP_VERSION__/__APP_BUILD__. Read version.json
// directly instead, matching how the web app's vite.config.ts does it.
const REPO_ROOT = resolve(process.cwd(), "..", ".."); // container cwd = /app/components/api
let BUILD = "unknown";
let VERSION = "unknown";
try {
  const ver = JSON.parse(readFileSync(join(REPO_ROOT, "version.json"), "utf8")) as { version: string; build: string };
  VERSION = ver.version;
  BUILD = ver.build;
} catch {
  console.warn("[health] version.json not found — reporting version/build as unknown");
}

router.get("/full", requireAuth, async (_req, res) => {
  const connectwise = resolveCwCreds().creds
    ? await getSystemInfo()
        .then((i) => ({ state: "ok" as const, detail: `Connected — CW ${i.version}` }))
        .catch((e) => ({ state: "down" as const, detail: e instanceof Error ? e.message : "unreachable" }))
    : { state: "warn" as const, detail: "Not configured" };

  const activeDirectory = adConfigured()
    ? { state: "idle" as const, detail: "LDAPS configured" }
    : { state: "warn" as const, detail: "Not configured — local login only" };

  const ais = getAisStatus();
  const aisstream = !ais.configured
    ? { state: "warn" as const, detail: "No API key" }
    : ais.tier1.connected || ais.tier2.connected
      ? { state: "ok" as const, detail: "Connected — see Tier 1 / Tier 2 below" }
      : { state: "down" as const, detail: "Key configured but neither tier is connected" };

  const aisTier1 = !ais.configured
    ? { state: "warn" as const, detail: "Not configured" }
    : {
        state: ais.tier1.connected ? ("ok" as const) : ("down" as const),
        detail:
          `${ais.tier1.connected ? "Connected" : "Disconnected"} — ${ais.tier1.subscribedMmsiCount} MMSIs, ` +
          `${ais.tier1.messagesReceivedLastMinute}/min (avg ${ais.tier1.avgProcessingMs.toFixed(2)}ms/max ${ais.tier1.maxProcessingMs.toFixed(2)}ms to process), ` +
          `${ais.tier1.reconnectCount} reconnects` +
          (ais.tier1.lastMessageAt ? `, last message ${ais.tier1.lastMessageAt}` : ", no messages yet"),
      };

  const aisTier2 = !ais.configured
    ? { state: "warn" as const, detail: "Not configured" }
    : {
        state: ais.tier2.poolSize === 0 ? ("idle" as const) : ais.tier2.connected ? ("ok" as const) : ("down" as const),
        detail:
          ais.tier2.poolSize === 0
            ? "No Tier 2 vessels currently"
            : `${ais.tier2.connected ? "Connected" : "Disconnected"} — batch ${ais.tier2.batchIndex}/${ais.tier2.batchCount}, ` +
              `${ais.tier2.poolSize} vessels in rotation, ${ais.tier2.messagesReceivedLastMinute}/min ` +
              `(avg ${ais.tier2.avgProcessingMs.toFixed(2)}ms/max ${ais.tier2.maxProcessingMs.toFixed(2)}ms to process), ${ais.tier2.reconnectCount} reconnects` +
              (ais.tier2.lastMessageAt ? `, last message ${ais.tier2.lastMessageAt}` : ", no messages yet"),
      };

  // "Are we keeping up" gauge — aisstream drops connections whose consumer
  // falls behind (INIT-0012). Node's real event-loop-delay histogram is a
  // direct, process-wide measure of that, not just an AIS-specific proxy.
  // Thresholds are a starting heuristic (our real message volume — ≤50
  // MMSIs per connection — is far under aisstream's ~300msg/s global-feed
  // budget, so danger here would mean something else entirely is blocking
  // the process), not a value aisstream publishes.
  const lag = readEventLoopLag();
  const backpressure = {
    state: lag.meanMs > 50 ? ("down" as const) : lag.meanMs > 10 ? ("warn" as const) : ("ok" as const),
    detail: `Event-loop lag — mean ${lag.meanMs.toFixed(2)}ms, p99 ${lag.p99Ms.toFixed(2)}ms, max ${lag.maxMs.toFixed(2)}ms (since last check)`,
  };

  res.json({
    app: { version: VERSION, build: BUILD, env: config.nodeEnv },
    integrations: { connectwise, aisstream, activeDirectory, aisTier1, aisTier2 },
    backpressure,
    cwWrites: isCwWritesEnabled(),
  });
});

export default router;
