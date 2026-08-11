import { Tabs } from "../ui";
import type { TabDef } from "../ui";
import { useTabParam } from "../useTabParam";
import { Vessel } from "./Vessel";
import { VesselIdentity } from "./VesselIdentity";
import { TrackingConfig } from "./TrackingConfig";
import { GeoAlerts } from "./GeoAlerts";

// One "Vessel Tracking" section; the former standalone pages are now tabs within
// it (mirrors the Extension page's tab pattern). Each panel keeps its own body
// and fetches on mount.
const tabs: TabDef[] = [
  { id: "config", label: "Tracking Config" },
  { id: "identity", label: "Vessel Identity" },
  { id: "location", label: "Vessel Location" },
  { id: "geo", label: "Geo Alerts" },
];

export function VesselTracking() {
  const [active, setActive] = useTabParam(
    tabs.map((t) => t.id),
    "config",
  );
  return (
    <div>
      <Tabs tabs={tabs} active={active} onChange={setActive} />
      {active === "location" ? (
        <Vessel />
      ) : active === "identity" ? (
        <VesselIdentity />
      ) : active === "config" ? (
        <TrackingConfig />
      ) : (
        <GeoAlerts />
      )}
    </div>
  );
}
