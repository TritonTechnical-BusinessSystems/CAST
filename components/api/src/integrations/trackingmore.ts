/**
 * TrackingMore — shipment tracking data source (INIT-0018). REST API, the
 * key is a server-side secret sent as the `Tracking-Api-Key` header. Docs:
 * https://www.trackingmore.com/docs/trackingmore/. No sync code consumes
 * this yet (INIT-0018 is design-complete, not built) — this module exists
 * so the credential can be entered/rotated on the Integrations page ahead
 * of that build-out, via the same encrypted-store pattern every other
 * integration uses (`integrations/simpleCreds.ts`).
 */
export const TRACKINGMORE_SLOT = "trackingmore";
export const TRACKINGMORE_DEFAULT_BASE_URL = "https://api.trackingmore.com/v4";

/**
 * Same SSRF/credential-exfiltration concern `connectwise/creds.ts`'s
 * `assertValidCwBaseUrl` closes, applied here: this URL gets the real
 * TrackingMore API key sent to it on every "Test connection" and (once
 * INIT-0018's sync lands) every real sync call, so an `integrations.write`
 * holder pointing it at an attacker-controlled host would hand that host
 * the key in plaintext.
 */
export function assertValidTrackingmoreUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("TrackingMore URL must be a valid URL");
  }
  if (parsed.protocol !== "https:") throw new Error("TrackingMore URL must use https://");
  const host = parsed.hostname.toLowerCase();
  if (host !== "trackingmore.com" && !host.endsWith(".trackingmore.com")) {
    throw new Error(`TrackingMore URL must be a trackingmore.com host — got "${host}"`);
  }
}
