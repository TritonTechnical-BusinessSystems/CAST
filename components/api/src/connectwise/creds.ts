/**
 * ConnectWise credential resolution — per CW instance, ALWAYS. Each instance
 * ("tritontech"/Production, "tritontech_cs1"/Sandbox, ...) has its own
 * encrypted secret slot (`connectwise:{instanceId}`) and its own resolution
 * — there is no shared/default/legacy slot and no cross-instance fallback of
 * any kind (removed 2026-08-19, user: "not comfortable with a fallback at
 * all for database access/reads/writes ... if something goes wrong and we
 * fallback to the wrong database, especially the Production one, we're
 * causing real damage to data"). An instance with nothing saved for it
 * resolves to `null` — full stop, never another instance's creds, and
 * never a Production default silently standing in for a missing field
 * (`baseUrl` included — see `assertValidCwBaseUrl` and the "all FIVE
 * fields" gate below; a pre-release security gate caught both a `baseUrl`
 * fallback and a missing host allowlist, 2026-08-19).
 */
import { getSecret, setSecret } from "../store/secretStore";

export interface CwCreds {
  baseUrl: string;
  company: string;
  publicKey: string;
  privateKey: string;
  clientId: string;
}

/** Raw stored value, however complete/incomplete — never validated, never used directly for a CW call. */
function getRawStoredCreds(instanceId: string): Partial<CwCreds> {
  const stored = getSecret(`connectwise:${instanceId}`);
  if (!stored) return {};
  try {
    return JSON.parse(stored) as Partial<CwCreds>;
  } catch {
    return {};
  }
}

export function resolveCwCredsForInstance(instanceId: string): { creds: CwCreds | null; source: "store" | "none" } {
  const c = getRawStoredCreds(instanceId);
  if (c.company && c.publicKey && c.privateKey && c.clientId && c.baseUrl) {
    return { creds: c as CwCreds, source: "store" };
  }
  return { creds: null, source: "none" };
}

/**
 * For the Integrations UI's status card ONLY — never for a CW call. Shows
 * whatever is actually stored, complete or not (blank, not a Production
 * default, for anything never explicitly saved for THIS instance — a
 * pre-release security gate caught the prior version defaulting an
 * unconfigured instance's displayed Site to Production's URL), so a
 * deliberately partial pre-seed (e.g. Sandbox's shared clientId) is visible
 * and its edit form can pre-fill from it, instead of `configured`'s strict
 * all-fields gate hiding it entirely (same raw-vs-strict split
 * `saveCwCredsForInstance` needs for correct merging — see its comment).
 */
export function getCredsDisplay(instanceId: string): { company: string; baseUrl: string; publicKeyMasked: string; clientId: string; configured: boolean; source: "store" | "none" } {
  const raw = getRawStoredCreds(instanceId);
  const { creds, source } = resolveCwCredsForInstance(instanceId);
  return {
    company: raw.company ?? "",
    baseUrl: raw.baseUrl ?? "",
    publicKeyMasked: raw.publicKey ? mask(raw.publicKey) : "",
    clientId: raw.clientId ?? "",
    configured: Boolean(creds),
    source,
  };
}

/** Resolve or throw loudly — the shared "give me real creds for this exact instance or fail" call every route/client makes. */
export function requireCredsForInstance(instanceId: string): CwCreds {
  const { creds } = resolveCwCredsForInstance(instanceId);
  if (!creds) throw new Error(`ConnectWise is not configured for instance "${instanceId}"`);
  return creds;
}

/**
 * Refuses anything but a real ConnectWise cloud host over `https://`
 * (originally security review, INIT-0026 Phase 3 — **found live 2026-08-19
 * to only ever have checked the scheme, never the host**, despite this
 * comment's own claim otherwise: every CW call sends the Basic-auth key
 * pair to whatever `baseUrl` is stored, so an `integrations.write` holder
 * could point an instance at an attacker-controlled `https://` host and the
 * next "Test connection" — reachable by ANY authenticated user, not just
 * `integrations.write` — would hand that host the real key pair in
 * plaintext, plus blind SSRF from the API container into the internal
 * network). Every real CW cloud host CAST talks to is a subdomain of
 * `myconnectwise.net` (regional clouds — `na.`, `eu.`, `au.`, ...) or the
 * documented staging host; nothing else is a legitimate destination for
 * these credentials, ever.
 */
// Both anchored with a leading dot so `.endsWith(suffix)` can only ever match
// the real domain or a genuine subdomain of it — NOT "evilmyconnectwise.net"
// or "evilstaging.connectwisedev.com" (the un-anchored second entry was a
// real gap, caught on re-review of the first fix, 2026-08-19).
const ALLOWED_CW_HOST_SUFFIXES = [".myconnectwise.net", ".staging.connectwisedev.com"];
const ALLOWED_CW_EXACT_HOSTS = ["myconnectwise.net", "staging.connectwisedev.com"];

function assertValidCwBaseUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("ConnectWise base URL must be a valid URL");
  }
  if (parsed.protocol !== "https:") throw new Error("ConnectWise base URL must use https://");
  const host = parsed.hostname.toLowerCase();
  const allowed = ALLOWED_CW_EXACT_HOSTS.includes(host) || ALLOWED_CW_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  if (!allowed) throw new Error(`ConnectWise base URL must be a myconnectwise.net (or documented staging) host — got "${host}"`);
}

export function mask(s: string): string {
  if (!s) return "";
  return s.length <= 4 ? "••••" : "••••" + s.slice(-4);
}

/**
 * Merge a partial credential update over the current set and store it
 * encrypted, per instance. A blank/omitted field leaves the existing stored
 * value untouched (user, 2026-08-19: "if a field is left blank ... that
 * field doesn't change ... so I can selectively update elements (API keys,
 * for instance) without impacting others") — `||`, not simple assignment,
 * on every field. `baseUrl` is validated on every save that sets it (never
 * defaulted) — an instance with no `baseUrl` of its own simply isn't
 * `configured` yet (see the five-field gate in `resolveCwCredsForInstance`).
 */
export function saveCwCredsForInstance(instanceId: string, input: Partial<CwCreds>) {
  // The merge baseline is the RAW stored value (however partial), not
  // resolveCwCredsForInstance()'s strict all-fields view — otherwise a
  // deliberately partial pre-seed (e.g. just clientId+baseUrl, ahead of
  // someone filling in the rest) would read back as "nothing stored" and
  // get silently discarded by the very next save instead of merged with it
  // (caught live migrating Sandbox's pre-seeded clientId, 2026-08-19).
  const raw = getRawStoredCreds(instanceId);
  const existing = {
    baseUrl: raw.baseUrl || "",
    company: raw.company || "",
    publicKey: raw.publicKey || "",
    privateKey: raw.privateKey || "",
    clientId: raw.clientId || "",
  };
  if (input.baseUrl) assertValidCwBaseUrl(input.baseUrl);
  const merged = {
    baseUrl: input.baseUrl || existing.baseUrl,
    company: input.company || existing.company,
    publicKey: input.publicKey || existing.publicKey,
    privateKey: input.privateKey || existing.privateKey,
    clientId: input.clientId || existing.clientId,
  };
  setSecret(`connectwise:${instanceId}`, JSON.stringify(merged));
}

/** Wipe an instance's stored credentials entirely — the only way to actually remove a leaked key pair, not just overwrite it (gap flagged in the pre-release security gate, 2026-08-19). */
export function clearCwCredsForInstance(instanceId: string): void {
  setSecret(`connectwise:${instanceId}`, JSON.stringify({ baseUrl: "", company: "", publicKey: "", privateKey: "", clientId: "" }));
}
