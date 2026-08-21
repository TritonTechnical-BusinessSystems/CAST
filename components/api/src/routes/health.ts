/**
 * System Health aggregation (INIT-0016). Probes each integration with a short
 * timeout and graceful degrade (the LC pattern), so the page always renders.
 */
import { Router } from "express";
import { readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { requirePermission } from "../middleware/auth";
import { config, adConfigured, isCwWritesEnabledForInstance } from "../config";
import { resolveCwCredsForInstance } from "../connectwise/creds";
import { getSystemInfo } from "../connectwise/manageClient";
import { listCwInstances } from "../connectwise/instances";

// The main "ConnectWise API" probe checks Production only — see
// routes/tracking.ts's CW_INSTANCE comment for why this is a literal.
const CW_INSTANCE = "tritontech";
import { getPackageManifest } from "../health/packages";
import { getContainers } from "../health/containers";
import { getAisStatus } from "../vessels/aisListener";
import { getMetricsHistory, getLatestMetricSample } from "../health/metrics";
import { getTlsExpiryProbe } from "../health/certExpiry";
import { getBackupFreshnessProbe } from "../health/backupFreshness";
import { recordIntegrationSample, getIntegrationMetricsHistory } from "../health/integrationMetrics";
import { DATA_DIR } from "../store/db";

const router = Router();

/** Package manifest + OSV.dev vulnerability check (cached 24h). */
router.get("/packages", requirePermission("system.read"), async (_req, res) => {
  try {
    res.json({ packages: await getPackageManifest() });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Package scan failed" });
  }
});

/** Docker container inventory, via the read-only docker-socket-proxy. */
router.get("/containers", requirePermission("system.read"), async (_req, res) => {
  try {
    res.json({ containers: await getContainers() });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Container query failed" });
  }
});

/** Resource-usage time series (CPU/memory/disk-IO/storage) — see health/metrics.ts. */
router.get("/metrics", requirePermission("system.read"), (_req, res) => {
  res.json(getMetricsHistory());
});

/** Integration performance time series (CW latency, AIS processing latency) — see health/integrationMetrics.ts. */
router.get("/integration-metrics", requirePermission("system.read"), (_req, res) => {
  res.json(getIntegrationMetricsHistory());
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

router.get("/full", requirePermission("system.read"), async (_req, res) => {
  // Timed so the SAME ping this probe already makes every ~15s (the frontend's
  // poll interval) also feeds the CW latency chart — no new load on CW.
  let cwSample: { latencyMs: number; ok: boolean } | null = null;
  const cwStart = Date.now();
  const cwCreds = resolveCwCredsForInstance(CW_INSTANCE).creds;
  const connectwise = cwCreds
    ? await getSystemInfo(cwCreds)
        .then((i) => {
          cwSample = { latencyMs: Date.now() - cwStart, ok: true };
          return { state: "ok" as const, detail: `Connected — CW ${i.version}` };
        })
        .catch((e) => {
          cwSample = { latencyMs: Date.now() - cwStart, ok: false };
          return { state: "down" as const, detail: e instanceof Error ? e.message : "unreachable" };
        })
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
  // Read from the metrics sampler's latest sample rather than the histogram
  // directly — readEventLoopLag() resets on every read, so this route and
  // the sampler both calling it would each only see a fraction of the window.
  const lag = getLatestMetricSample();
  const backpressure = {
    state: !lag ? ("idle" as const) : lag.eventLoopLagMeanMs > 50 ? ("down" as const) : lag.eventLoopLagMeanMs > 10 ? ("warn" as const) : ("ok" as const),
    detail: !lag
      ? "No samples yet"
      : `Event-loop lag — mean ${lag.eventLoopLagMeanMs.toFixed(2)}ms, p99 ${lag.eventLoopLagP99Ms.toFixed(2)}ms, max ${lag.eventLoopLagMaxMs.toFixed(2)}ms (since last sample)`,
  };

  let dbSizeBytes = 0;
  try {
    dbSizeBytes = statSync(join(DATA_DIR, "cast.db")).size;
  } catch {
    // No DB file yet (fresh install) — 0 is a fine default, not an error worth surfacing.
  }

  const tls = await getTlsExpiryProbe();
  const backups = getBackupFreshnessProbe();

  recordIntegrationSample({
    at: new Date().toISOString(),
    cw: cwSample,
    aisTier1: ais.configured ? { avgProcessingMs: ais.tier1.avgProcessingMs, maxProcessingMs: ais.tier1.maxProcessingMs } : null,
    aisTier2: ais.configured ? { avgProcessingMs: ais.tier2.avgProcessingMs, maxProcessingMs: ais.tier2.maxProcessingMs } : null,
  });

  res.json({
    app: { version: VERSION, build: BUILD, env: config.nodeEnv, uptimeSeconds: process.uptime(), dbSizeBytes },
    integrations: { connectwise, aisstream, activeDirectory, aisTier1, aisTier2 },
    infra: { tls, backups },
    backpressure,
    // Per instance, not one collapsed boolean (2026-08-20 security review: a
    // single flag sourced from Production alone would hide Sandbox writes
    // being live) — every registered instance's actual gate state.
    cwWrites: listCwInstances().map((i) => ({ id: i.id, name: i.name, enabled: isCwWritesEnabledForInstance(i.id) })),
  });
});

export default router;
