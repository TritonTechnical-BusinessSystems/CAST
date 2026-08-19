import { PageHeader, Tabs } from "../ui";
import type { TabDef } from "../ui";
import { useTabParam } from "../useTabParam";
import { LogisticsConfigBranding } from "./LogisticsConfigBranding";
import { LogisticsConfigCarriers } from "./LogisticsConfigCarriers";
import { LogisticsConfigCurrencies } from "./LogisticsConfigCurrencies";
import { LogisticsConfigExportPresets } from "./LogisticsConfigExportPresets";
import { LogisticsConfigCiFlags } from "./LogisticsConfigCiFlags";
import { LogisticsConfigReceiving } from "./LogisticsConfigReceiving";
import { LogisticsConfigEmbedLinks } from "./LogisticsConfigEmbedLinks";

// Incoterms (LC's other config section) has no dedicated tab here — it's a
// static 11-value reference list with nothing to configure, consumed
// directly by shipment/document forms in later phases (`GET
// /api/logistics/config/incoterms`), not a page a human visits.
const tabs: TabDef[] = [
  { id: "branding", label: "Branding / Ship As" },
  { id: "carriers", label: "Carriers" },
  { id: "currencies", label: "Currencies" },
  { id: "export-presets", label: "Export Presets" },
  { id: "ci-flags", label: "CI Flags" },
  { id: "receiving", label: "Receiving" },
  { id: "embed-links", label: "Embed Links" },
];

/**
 * Logistics main page (INIT-0026's native rebuild of LogisticsCoordinator).
 * Configuration is the default landing content — day-to-day *use* of
 * Logistics (Outbound Shipments, Receiving once built) happens embedded
 * inside ConnectWise via Custom Menu Entry Links, not by browsing here, so
 * this page's job is configuring that shared setup + generating those embed
 * links (the "Embed Links" tab), reorganized 2026-08-18 (was a standalone
 * "/logistics/config" page one click away from the actual landing page —
 * see the "/logistics/config" redirect in App.tsx for the old route).
 */
export function Logistics() {
  const [active, setActive] = useTabParam(
    tabs.map((t) => t.id),
    "branding",
  );
  return (
    <div className="col gap-4">
      <PageHeader
        title="Logistics"
        subtitle="Shared configuration for Outbound Shipments, Documents, and Receiving, plus ConnectWise embed links. Also reachable embedded from ConnectWise."
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
      ) : active === "receiving" ? (
        <LogisticsConfigReceiving />
      ) : (
        <LogisticsConfigEmbedLinks />
      )}
    </div>
  );
}
