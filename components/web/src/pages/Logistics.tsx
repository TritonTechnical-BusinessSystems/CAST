import { PageHeader, Tabs } from "../ui";
import type { TabDef } from "../ui";
import { useTabParam } from "../useTabParam";
import { LogisticsConfigBranding } from "./LogisticsConfigBranding";
import { LogisticsConfigExportPresets } from "./LogisticsConfigExportPresets";
import { LogisticsConfigCiFlags } from "./LogisticsConfigCiFlags";
import { LogisticsConfigReceiving } from "./LogisticsConfigReceiving";
import { LogisticsConfigEmbedLinks } from "./LogisticsConfigEmbedLinks";

// Incoterms (LC's other config section) has no dedicated tab here — it's a
// static 11-value reference list with nothing to configure, consumed
// directly by shipment/document forms in later phases (`GET
// /api/logistics/config/incoterms`), not a page a human visits.
//
// Carriers and Currencies (2026-08-21, user: "we don't actually need to show
// [these] tabs... They just need to be usable within the app") are the same
// shape — both are read-only, live CW lookups with nothing to configure here,
// no add/remove/edit of any kind. Their real consumer is the carrier/currency
// pickers in LogisticsShipmentDocuments.tsx, which calls the identical
// `GET /api/logistics/:instance/config/{carriers,currencies}` routes directly
// and is untouched by this — a standalone read-only display tab for data with
// no configuration action was the part that added nothing. The backend routes
// and manageClient.ts's listCarrierOptions/listCurrencyOptions (including the
// defensive fix below for a currency with no ISO code) stay exactly as they
// are; only these two tabs and their now-unused page components are gone.
const tabs: TabDef[] = [
  { id: "branding", label: "Branding / Ship As" },
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
