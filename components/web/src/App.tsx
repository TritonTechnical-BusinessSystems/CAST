import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Extension } from "./pages/Extension";
import { Vessel } from "./pages/Vessel";
import { VesselIdentity } from "./pages/VesselIdentity";
import { TrackingConfig } from "./pages/TrackingConfig";
import { Integrations } from "./pages/Integrations";
import { SystemHealth } from "./pages/SystemHealth";

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

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route path="/extension" element={<Extension />} />
        <Route path="/vessel" element={<Vessel />} />
        <Route path="/vessel-identity" element={<VesselIdentity />} />
        <Route path="/tracking" element={<TrackingConfig />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route path="/health" element={<SystemHealth />} />
      </Route>
      <Route path="*" element={<Navigate to="/extension" replace />} />
    </Routes>
  );
}
