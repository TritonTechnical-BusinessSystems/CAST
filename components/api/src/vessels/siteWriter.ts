/**
 * Formats the Vessel Site write (redesigned 2026-08-17, decided directly
 * with the user):
 *
 * - `name` = a confidence-colored status line — 🟢 current (≤2h old),
 *   🔵 presumed (older, but still a reasoned-safe guess — a stationary
 *   vessel, or an underway one still inside its ETA + grace window),
 *   🟠 stale (no reasoning basis left, but still a real last-known fact —
 *   shown with distrust rather than gone silent). Examples:
 *   "🟢 Vessel docked in Napoli, Italy" /
 *   "🔵 Vessel underway to Sundneset (ETA: 17 Aug 23:00 UTC)". Past
 *   `FALLBACK_MS` (confidence.ts) with nothing fresher at all, even "docked
 *   in the same yard for months" stops being a safe presumption — the name
 *   reverts to a bare, unstatused "Vessel".
 * - `addressLine1` = coordinates, comma+space-joined, rounded to 5 decimal
 *   places (~1m — more than enough for a vessel two orders of magnitude
 *   larger than that; user, 2026-08-18, superseding the earlier "whatever
 *   the feed gives, no space" call from the day before). Omitted (not
 *   overwritten) once the tier is "expired" — we have no current confidence
 *   in a position to assert one.
 * - `timeZoneSetupId` = the CW `timeZoneSetups` entry (timezone.ts) for the
 *   vessel's own coordinates — priority 1 always coordinates; priority 2
 *   (rare, only if that lookup itself fails) the vessel's resolved CURRENT
 *   place's country, never `destination` (that's where it's headed, not
 *   where it is — using it would assign the wrong zone for anything still
 *   underway). Omitted alongside `addressLine1` when expired.
 * - `lastAisUpdateText` = the "Last AIS Data Update" custom field (added by
 *   the user 2026-08-17, replacing an earlier "Site Notes" plan) — the true
 *   last-confirmed date, written in EVERY tier including "expired", since
 *   that field's whole purpose is showing exactly how stale things are even
 *   once the name itself has reverted to a bare "Vessel".
 *
 * Pure and I/O-free by design, matching this codebase's other decision
 * modules (siteResolution.ts, priority.ts) — the caller
 * (jobs/tierRefresh.ts) supplies the position data and only calls
 * CwClient.updateVesselSite when the result actually differs from what's
 * cached as last-written.
 */
import type { VesselPosition } from "./positionStore";
import { statusBucket } from "./navStatus";
import { confidenceTier, TIER_EMOJI } from "./confidence";
import { nearestPort } from "./nearestPort";
import { resolveTimeZoneSetupId } from "./timezone";

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

// AIS Destination is a free-text field, unauthenticated and crew-entered —
// spoofable and often messy in practice. The protocol itself caps it at 20
// six-bit characters (ITU-R M.1371), so anything longer here already
// indicates a parsing anomaly upstream; truncate defensively rather than
// write an unbounded string into a ConnectWise Site name.
const MAX_DESTINATION_LEN = 20;

function truncateDestination(text: string): string {
  return text.length > MAX_DESTINATION_LEN ? `${text.slice(0, MAX_DESTINATION_LEN)}…` : text;
}

function formatConfirmedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.getUTCDate();
  const month = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} ${hh}:${mm} UTC`;
}

export interface SiteUpdate {
  name: string;
  addressLine1?: string;
  timeZoneSetupId?: number;
  lastAisUpdateText: string;
}

/** Null only when there is truly nothing to say — no update, of any kind, has ever been received for this vessel. */
export function formatSiteUpdate(position: VesselPosition | undefined): SiteUpdate | null {
  if (!position || !position.lastSeenAt) return null;

  const bucket = statusBucket(position.navStatusCode);
  const tier = confidenceTier(bucket, {
    lastSeenAt: position.lastSeenAt,
    destination: position.destination,
    etaIso: position.etaIso,
  });
  const lastAisUpdateText = formatConfirmedDate(position.lastSeenAt);

  if (tier === "expired") {
    return { name: "Vessel", lastAisUpdateText };
  }

  const emoji = TIER_EMOJI[tier];
  const hasPosition = position.lat != null && position.lon != null;
  const port = hasPosition ? nearestPort(position.lat as number, position.lon as number) : null;
  const near = placeName(port);
  const addressLine1 = hasPosition ? `${(position.lat as number).toFixed(5)}, ${(position.lon as number).toFixed(5)}` : null;

  let name: string;
  if (bucket === "underway") {
    if (position.destination) {
      name = `${emoji} Vessel underway to ${truncateDestination(position.destination)}${formatEta(position.etaIso)}`;
    } else if (near) {
      name = `${emoji} Vessel underway near ${near}`;
    } else {
      name = `${emoji} Vessel underway at sea`;
    }
  } else if (bucket === "unknown") {
    name = near ? `${emoji} Vessel near ${near}` : `${emoji} Vessel — status unknown`;
  } else {
    const verb = bucket === "docked" ? "docked in" : bucket === "anchored" ? "anchored near" : "aground near";
    name = near ? `${emoji} Vessel ${verb} ${near}` : addressLine1 ? `${emoji} Vessel ${bucket} at ${addressLine1}` : `${emoji} Vessel ${bucket}`;
  }

  if (!hasPosition || addressLine1 == null) {
    return { name, lastAisUpdateText };
  }

  const timeZoneSetupId = resolveTimeZoneSetupId(position.lat as number, position.lon as number, port?.country ?? null) ?? undefined;

  return { name, addressLine1, timeZoneSetupId, lastAisUpdateText };
}
