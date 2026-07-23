/**
 * App-assisted operator lookup links (INIT-0014).
 *
 * The reconciliation flow is deliberately free and ToS-safe: we do NOT scrape or
 * call a paid API. We hand the operator a prefilled deep-link to a public vessel
 * registry, they read the missing identifier (and confirm name/flag match), then
 * paste it back for the server to validate + write. A human clicking through is
 * ordinary use of these sites — no automated extraction.
 *
 * The dominant gap for this (superyacht) fleet is IMO→MMSI, so links are built
 * primarily from a known IMO; a name-based fallback covers vessels missing both.
 */

export interface RegistryLink {
  label: string;
  url: string;
  note?: string;
}

/** Deep-links to look a vessel up by its IMO number (to read off the MMSI). */
export function registryLinksForImo(imo: string): RegistryLink[] {
  const q = encodeURIComponent(imo);
  return [
    {
      label: "Balytic Shipping",
      url: `https://www.balticshipping.com/vessel/imo/${q}`,
      note: "Direct IMO page; shows MMSI",
    },
    {
      label: "VesselFinder",
      url: `https://www.vesselfinder.com/vessels?name=${q}`,
    },
    {
      label: "Web search",
      url: `https://www.google.com/search?q=IMO+${q}+MMSI`,
    },
  ];
}

/** Fallback when only a name is known (vessel missing both IMO and MMSI). */
export function registryLinksForName(name: string): RegistryLink[] {
  const q = encodeURIComponent(name);
  return [
    {
      label: "VesselFinder",
      url: `https://www.vesselfinder.com/vessels?name=${q}`,
    },
    {
      label: "Web search",
      url: `https://www.google.com/search?q=${encodeURIComponent(`yacht "${name}" IMO MMSI`)}`,
    },
  ];
}
