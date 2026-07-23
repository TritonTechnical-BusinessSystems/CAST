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
import { startVesselSync } from "./jobs/vesselSync";
import { seedBreakGlass } from "./auth/local";

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

app.listen(config.port, () => {
  console.log(`[cast-api] listening on :${config.port} (${config.nodeEnv})`);
  seedBreakGlass();
  startVesselSync();
});
