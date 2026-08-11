/**
 * Formats the Vessel Site write: `name` = friendly status + place/
 * destination, `addressLine1` = raw decimal coordinates (decided
 * 2026-08-11, user — examples: "Vessel docked in La Ciotat, France" /
 * "Vessel underway to Barcelona, Spain (ETA: 11 Aug 21:15 UTC)").
 *
 * Pure and I/O-free by design, matching this codebase's other decision
 * modules (siteResolution.ts, priority.ts) — the caller (jobs/tierRefresh.ts)
 * supplies the position/voyage data and only calls CwClient.updateVesselSite
 * when the result actually differs from what's cached as last-written.
 *
 * Stale/unknown data is a deliberate no-op, not an overwrite (architecture
 * note: "keep last-known + a timestamp, don't blank the address on a gap")
 * — a moored vessel that stops transmitting for a while is still almost
 * certainly right where it was.
 *
 * ETA is shown in UTC, not the destination's local time (the "UTC+1" in the
 * original example would need a destination-name -> timezone lookup this
 * doesn't have — AIS itself transmits ETA as a bare UTC-relative timestamp
 * with no timezone info at all).
 */
import type { VesselPosition } from "./positionStore";
import { statusBucket } from "./navStatus";
import { nearestPort } from "./nearestPort";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

function placeName(port: { name: string; country: string } | null): string | null {
  if (!port) return null;
  let country = port.country;
  try {
    country = countryNames.of(port.country) ?? port.country;
  } catch {
    // Unrecognized/malformed region code — fall back to the raw code.
  }
  return `${port.name}, ${country}`;
}

function formatEta(etaIso: string | null): string {
  if (!etaIso) return "";
  const d = new Date(etaIso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getUTCDate();
  const month = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return ` (ETA: ${day} ${month} ${hh}:${mm} UTC)`;
}

export interface SiteUpdate {
  name: string;
  addressLine1: string;
}

/** Null when there's nothing fresh/usable to write — the caller should leave the site untouched. */
export function formatSiteUpdate(position: VesselPosition | undefined): SiteUpdate | null {
  if (!position || position.lat == null || position.lon == null) return null;

  const bucket = statusBucket(position.navStatusCode, position.lastSeenAt);
  if (bucket === "unknown") return null;

  const addressLine1 = `${position.lat}, ${position.lon}`;
  const port = nearestPort(position.lat, position.lon);
  const near = placeName(port);

  let name: string;
  if (bucket === "underway") {
    if (position.destination) {
      name = `Vessel underway to ${position.destination}${formatEta(position.etaIso)}`;
    } else if (near) {
      name = `Vessel underway near ${near}`;
    } else {
      name = "Vessel underway at sea";
    }
  } else {
    const verb = bucket === "docked" ? "docked in" : bucket === "anchored" ? "anchored near" : "aground near";
    name = near ? `Vessel ${verb} ${near}` : `Vessel ${bucket} at ${addressLine1}`;
  }

  return { name, addressLine1 };
}
