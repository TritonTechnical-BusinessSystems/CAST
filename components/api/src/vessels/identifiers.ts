/**
 * Vessel identifier validation — IMO number + MMSI (INIT-0014).
 *
 * Pure, dependency-free, and authoritative: the reconciliation UI lets an
 * operator paste a looked-up value, but the SERVER validates before writing to
 * ConnectWise (never trust client input). Both identifiers self-validate with no
 * network call, so typos/transpositions are caught instantly — the first line of
 * defence before any registry lookup.
 */

export interface IdCheck {
  /** The raw value as given (trimmed), or null if absent. */
  raw: string | null;
  /** Normalized digits (IMO: 7, MMSI: 9), or null if unparseable. */
  normalized: string | null;
  /** Was any value supplied at all? */
  present: boolean;
  /** Is the supplied value structurally valid? (false when absent.) */
  valid: boolean;
  /** Human reason when invalid/absent — drives the UI hint. */
  reason?: string;
}

const absent: IdCheck = { raw: null, normalized: null, present: false, valid: false, reason: "Not set" };

/**
 * IMO number: 7 digits where the 7th is a check digit — each of the first six
 * digits is multiplied by 7,6,5,4,3,2, summed, and the last digit of that sum
 * must equal the 7th digit. Accepts an optional "IMO" prefix and stray spaces.
 */
export function checkImo(input: string | null | undefined): IdCheck {
  if (input == null || String(input).trim() === "") return absent;
  const raw = String(input).trim();
  const digits = raw.replace(/^IMO\s*/i, "").replace(/\s+/g, "");
  if (!/^\d{7}$/.test(digits)) {
    return { raw, normalized: null, present: true, valid: false, reason: "IMO must be 7 digits" };
  }
  const factors = [7, 6, 5, 4, 3, 2];
  const sum = factors.reduce((acc, f, i) => acc + f * Number(digits[i]), 0);
  const expected = sum % 10;
  const actual = Number(digits[6]);
  if (expected !== actual) {
    return {
      raw,
      normalized: null,
      present: true,
      valid: false,
      reason: `IMO check digit fails (expected ${expected}, got ${actual}) — likely a typo`,
    };
  }
  return { raw, normalized: digits, present: true, valid: true };
}

/**
 * MMSI: 9 digits. A ship-station MMSI leads with a country prefix (MID) whose
 * first digit is 2–7; other leading digits (0 = coast station, 1 = SAR, 8/9 =
 * device/craft-associated) are valid MMSIs but not a vessel — flag those so a
 * mistyped or non-ship number doesn't get written as the vessel's identity.
 */
export function checkMmsi(input: string | null | undefined): IdCheck {
  if (input == null || String(input).trim() === "") return absent;
  const raw = String(input).trim();
  const digits = raw.replace(/\s+/g, "");
  if (!/^\d{9}$/.test(digits)) {
    return { raw, normalized: null, present: true, valid: false, reason: "MMSI must be 9 digits" };
  }
  const lead = Number(digits[0]);
  if (lead < 2 || lead > 7) {
    return {
      raw,
      normalized: digits,
      present: true,
      valid: false,
      reason: "Not a ship-station MMSI (a vessel's MMSI starts 2–7)",
    };
  }
  return { raw, normalized: digits, present: true, valid: true };
}
