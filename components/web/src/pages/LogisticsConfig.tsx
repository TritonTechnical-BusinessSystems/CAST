import { PageHeader, Tabs } from "../ui";
import type { TabDef } from "../ui";
import { useTabParam } from "../useTabParam";
import { LogisticsConfigBranding } from "./LogisticsConfigBranding";
import { LogisticsConfigCarriers } from "./LogisticsConfigCarriers";
import { LogisticsConfigCurrencies } from "./LogisticsConfigCurrencies";
import { LogisticsConfigExportPresets } from "./LogisticsConfigExportPresets";
import { LogisticsConfigCiFlags } from "./LogisticsConfigCiFlags";
import { LogisticsConfigReceiving } from "./LogisticsConfigReceiving";

// Incoterms (LC's other config section) has no dedicated tab here — it's a
// static 11-value reference list with nothing to configure, consumed
// directly by shipment/document forms in later phases (`GET
// /api/logistics/config/incoterms`), not a page a human visits.
const tabs: TabDef[] = [
  { id: "branding", label: "Ship As Companies" },
  { id: "carriers", label: "Carriers" },
  { id: "currencies", label: "Currencies" },
  { id: "export-presets", label: "Export Presets" },
  { id: "ci-flags", label: "CI Flags" },
  { id: "receiving", label: "Receiving" },
];

export function LogisticsConfig() {
  const [active, setActive] = useTabParam(
    tabs.map((t) => t.id),
    "branding",
  );
  return (
    <div className="col gap-4">
      <PageHeader
        title="Logistics Configuration"
        subtitle="Shared settings for Outbound Shipments, Documents, and Receiving. Also reachable embedded from ConnectWise."
      />
      <Tabs tabs={tabs} active={active} onChange={setActive} />
      {active === "branding" ? (
        <LogisticsConfigBranding />
      ) : active === "carriers" ? (
        <LogisticsConfigCarriers />
      ) : active === "currencies" ? (
        <LogisticsConfigCurrencies />
      ) : active === "export-presets" ? (
        <LogisticsConfigExportPresets />
      ) : active === "ci-flags" ? (
        <LogisticsConfigCiFlags />
      ) : (
        <LogisticsConfigReceiving />
      )}
    </div>
  );
}
