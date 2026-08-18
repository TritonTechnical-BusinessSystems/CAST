import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { Download } from "./pages/Download";
import { Login } from "./pages/Login";
import { Extension } from "./pages/Extension";
import { VesselTracking } from "./pages/VesselTracking";
import { Logistics } from "./pages/Logistics";
import { LogisticsShipments } from "./pages/LogisticsShipments";
import { LogisticsShipment } from "./pages/LogisticsShipment";
import { Integrations } from "./pages/Integrations";
import { SystemHealth } from "./pages/SystemHealth";
import { PrintCI } from "./pages/PrintCI";
import { PrintPL } from "./pages/PrintPL";

/** Gate the authenticated app; bounce to /login when there's no session. */
function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

/** The bare site root / unknown paths: signed-in users get the app, everyone
 *  else gets the public download front door. */
function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={user ? "/extension" : "/download"} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/download" element={<Download />} />
      <Route path="/login" element={<Login />} />
      {/* No Layout/RequireAuth wrapper — reached only by the backend's internal
          Playwright render (pdf/render.ts), which carries its own short-lived
          service session cookie rather than an interactive login. */}
      <Route path="/print/ci/:id" element={<PrintCI />} />
      <Route path="/print/pl/:id" element={<PrintPL />} />
      <Route element={<RequireAuth />}>
        <Route path="/extension" element={<Extension />} />
        <Route path="/vessel-tracking" element={<VesselTracking />} />
        <Route path="/logistics" element={<Logistics />} />
        {/* Configuration is now the main /logistics page itself (embed links
            moved to a tab within it), not a separate page one click away. */}
        <Route path="/logistics/config" element={<Navigate to="/logistics?tab=branding" replace />} />
        <Route path="/logistics/shipments" element={<LogisticsShipments />} />
        <Route path="/logistics/shipment/:id" element={<LogisticsShipment />} />
        {/* Legacy per-page paths now live as tabs under /vessel-tracking (keep the tab). */}
        <Route path="/vessel" element={<Navigate to="/vessel-tracking?tab=location" replace />} />
        <Route path="/vessel-identity" element={<Navigate to="/vessel-tracking?tab=identity" replace />} />
        <Route path="/tracking" element={<Navigate to="/vessel-tracking?tab=config" replace />} />
        <Route path="/geo-alerts" element={<Navigate to="/vessel-tracking?tab=geo" replace />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route path="/health" element={<SystemHealth />} />
      </Route>
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
