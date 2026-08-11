/**
 * Vessel Site resolution (INIT-0012) — each tracked company's write target is
 * whichever of its CW sites is named "Vessel..." (case-insensitive prefix).
 * Resolved once, then cached by SITE ID so a later rename of that site never
 * breaks the mapping — only the site being deleted or inactivated does,
 * which clears the cache and re-triggers detection.
 *
 * Pure and I/O-free: the caller fetches the company's current CW sites
 * (`CwClient.getCompanySites`) and the previously-cached id (settings store);
 * this module only decides the next state. A company with no resolvable
 * Vessel Site is excluded from AIS tracking entirely (see `priority.ts`).
 */
import type { CwSite } from "../connectwise/client";

export type SiteResolutionReason = "kept" | "resolved" | "cleared" | "none";

export interface SiteResolution {
  /** The site id to cache going forward, or null if none is resolvable. */
  siteId: string | null;
  /** Did the cached value change this run? */
  changed: boolean;
  reason: SiteResolutionReason;
  /** Set when more than one active candidate existed — the first (lowest id) won. */
  ambiguous?: boolean;
}

function isVesselSite(s: CwSite): boolean {
  return !s.inactive && s.name.trim().toLowerCase().startsWith("vessel");
}

/** Stable pick when multiple candidates exist: lowest id first. */
function pickCandidate(sites: CwSite[]): CwSite | undefined {
  return [...sites.filter(isVesselSite)].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))[0];
}

export function resolveVesselSite(sites: CwSite[], cachedSiteId: string | null | undefined): SiteResolution {
  const cached = cachedSiteId ?? null;

  if (cached) {
    const current = sites.find((s) => s.id === cached);
    // Renames don't matter once cached — only gone-or-inactive does.
    if (current && !current.inactive) return { siteId: cached, changed: false, reason: "kept" };
  }

  // No usable cached id (never set, or just invalidated) — (re)detect.
  const candidates = sites.filter(isVesselSite);
  const picked = pickCandidate(sites);
  if (!picked) {
    return { siteId: null, changed: cached !== null, reason: cached !== null ? "cleared" : "none" };
  }
  return { siteId: picked.id, changed: picked.id !== cached, reason: "resolved", ambiguous: candidates.length > 1 };
}
