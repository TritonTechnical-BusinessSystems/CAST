/**
 * Credential storage for CAST's single-key, single-endpoint integrations
 * (aisstream.io, TrackingMore) — same encrypted-store + partial-merge shape
 * as `connectwise/creds.ts`, simplified for a provider with exactly one
 * account (no multi-instance concept the way ConnectWise has Production/
 * Sandbox). Added 2026-08-20 migrating both providers off `.env`-only
 * config (user: make them fully editable in-app, matching the pattern
 * ConnectWise already uses, not a redeploy-to-rotate-a-key setup).
 */
import { getSecret, setSecret } from "../store/secretStore";

export interface SimpleCreds {
  apiKey: string;
  url: string;
}

interface RawSimpleCreds {
  apiKey?: string;
  url?: string;
}

function secretName(slot: string): string {
  return `integration:${slot}`;
}

function getRaw(slot: string): RawSimpleCreds {
  const stored = getSecret(secretName(slot));
  if (!stored) return {};
  try {
    return JSON.parse(stored) as RawSimpleCreds;
  } catch {
    return {};
  }
}

/** `apiKey` must be explicitly saved — `url` falls back to the provider's documented default when blank (unlike CW's baseUrl, which has no safe default across instances). */
export function resolveSimpleCreds(slot: string, defaultUrl: string): { creds: SimpleCreds | null; source: "store" | "none" } {
  const raw = getRaw(slot);
  if (!raw.apiKey) return { creds: null, source: "none" };
  return { creds: { apiKey: raw.apiKey, url: raw.url || defaultUrl }, source: "store" };
}

export function isSimpleCredsConfigured(slot: string): boolean {
  return Boolean(getRaw(slot).apiKey);
}

/** For the Integrations UI's status card ONLY — masked key, never the real value. */
export function getSimpleCredsDisplay(slot: string, defaultUrl: string): { apiKeyMasked: string; url: string; configured: boolean; source: "store" | "none" } {
  const raw = getRaw(slot);
  return {
    apiKeyMasked: raw.apiKey ? mask(raw.apiKey) : "",
    url: raw.url || defaultUrl,
    configured: Boolean(raw.apiKey),
    source: raw.apiKey ? "store" : "none",
  };
}

export function mask(s: string): string {
  if (!s) return "";
  return s.length <= 4 ? "••••" : "••••" + s.slice(-4);
}

/**
 * Partial save — a blank/omitted field leaves the existing stored value
 * untouched, same reasoning as `connectwise/creds.ts`'s
 * `saveCwCredsForInstance`. `validateUrl` is REQUIRED (not optional) so this
 * enforces the host allowlist at the storage boundary itself, not only in
 * whichever route happens to call it (security review, 2026-08-21: CW's
 * equivalent validates inside `saveCwCredsForInstance`; the first version of
 * this generic module validated only in `routes/integrations.ts`, one
 * missed call site away from silently reopening the SSRF/credential-
 * exfiltration path this exists to close — worse here since the module is
 * explicitly meant to be reused by future single-account providers).
 */
export function saveSimpleCreds(slot: string, input: Partial<SimpleCreds>, validateUrl: (url: string) => void): void {
  if (input.url) validateUrl(input.url);
  const raw = getRaw(slot);
  const merged: RawSimpleCreds = {
    apiKey: input.apiKey || raw.apiKey || "",
    url: input.url || raw.url || "",
  };
  setSecret(secretName(slot), JSON.stringify(merged));
}

export function clearSimpleCreds(slot: string): void {
  setSecret(secretName(slot), JSON.stringify({ apiKey: "", url: "" }));
}
