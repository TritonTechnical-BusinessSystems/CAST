/**
 * Parses AIS ShipStaticData's ETA + Destination fields. UNVERIFIED against
 * real traffic (see aisListener.ts's header) — built from the documented
 * ITU-R M.1371 field semantics and aisstream's PascalCase convention for its
 * other fields (Latitude, Longitude, Sog, Cog, NavigationalStatus), not from
 * an observed real message. Defensive on purpose: returns null rather than
 * guessing on anything that doesn't match, so a wrong assumption here just
 * means no ETA shown (silently degrades), not garbage data.
 */

/** Raw AIS string fields are fixed-width, "@"-padded — strip padding/whitespace, empty -> null. */
export function cleanAisString(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const cleaned = s.replace(/@+$/, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

interface RawEta {
  Month?: number;
  Day?: number;
  Hour?: number;
  Minute?: number;
}

/**
 * AIS ETA has no year (it's assumed near-term) and uses sentinel values for
 * "not available": Month=0, Day=0, Hour=24, Minute=60. Infers the year as
 * "next occurrence of this month/day from now" so a January ETA reported in
 * December still resolves forward, not into the past.
 */
export function parseAisEta(raw: unknown, now: Date): string | null {
  if (!raw || typeof raw !== "object") return null;
  const { Month, Day, Hour, Minute } = raw as RawEta;
  if (!Month || !Day || Month < 1 || Month > 12 || Day < 1 || Day > 31) return null;
  const hour = Hour != null && Hour < 24 ? Hour : 0;
  const minute = Minute != null && Minute < 60 ? Minute : 0;

  const year = now.getUTCFullYear();
  let eta = new Date(Date.UTC(year, Month - 1, Day, hour, minute));
  if (eta.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    eta = new Date(Date.UTC(year + 1, Month - 1, Day, hour, minute));
  }
  return eta.toISOString();
}
