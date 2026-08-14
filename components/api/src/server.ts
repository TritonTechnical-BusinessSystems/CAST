import express from "express";
import cookieParser from "cookie-parser";
import { config } from "./config";
import authRoutes from "./routes/auth";
import configRoutes from "./routes/config";
import vesselRoutes from "./routes/vessels";
import vesselIdentityRoutes from "./routes/vesselIdentity";
import trackingRoutes from "./routes/tracking";
import integrationRoutes from "./routes/integrations";
import healthRoutes from "./routes/health";
import geoAlertRoutes from "./routes/geoAlerts";
import checkinRoutes from "./routes/checkins";
import extensionRoutes from "./routes/extension";
import logisticsRoutes from "./routes/logistics";
import logisticsShipmentsRoutes from "./routes/logisticsShipments";
import logisticsDocumentsRoutes from "./routes/logisticsDocuments";
import { startTierRefresh, stopTierRefresh } from "./jobs/tierRefresh";
import { startAisListener, stopAisListener } from "./vessels/aisListener";
import { seedBreakGlass } from "./auth/local";
import { db } from "./store/db";

const app = express();
app.use(express.json());
app.use(cookieParser());

// nginx serves the SPA and proxies /api/* here (SOC-style deployment).
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/config", configRoutes);
app.use("/api/vessels", vesselRoutes);
app.use("/api/vessel-identity", vesselIdentityRoutes);
app.use("/api/tracking", trackingRoutes);
app.use("/api/integrations", integrationRoutes);
app.use("/api/health", healthRoutes);
app.use("/api/geo-alerts", geoAlertRoutes);
app.use("/api/checkins", checkinRoutes);
app.use("/api/extension", extensionRoutes);
app.use("/api/logistics", logisticsRoutes);
app.use("/api/logistics", logisticsShipmentsRoutes);
app.use("/api/logistics", logisticsDocumentsRoutes);

const server = app.listen(config.port, () => {
  console.log(`[cast-api] listening on :${config.port} (${config.nodeEnv})`);
  seedBreakGlass();
  startTierRefresh();
  startAisListener();
});

// better-sqlite3 must finalize its prepared statements before the Node
// environment tears down (docker stop / compose recreate sends SIGTERM) — an
// abrupt process exit races that finalization against Node's own cleanup-hook
// removal and crashes with "Assertion failed: (env) != nullptr" in
// RemoveEnvironmentCleanupHook. Closing the db first avoids the race.
function shutdown() {
  stopTierRefresh();
  stopAisListener();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
