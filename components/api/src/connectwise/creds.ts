/**
 * ConnectWise credential resolution. Precedence: the encrypted store (set via the
 * in-app Integrations screen, INIT-0013) wins over env (`.env`), so ops can rotate
 * keys in the UI without a redeploy. Secrets never leave the server.
 */
import { config } from "../config";
import { getSecret, setSecret } from "../store/secretStore";

export interface CwCreds {
  baseUrl: string;
  company: string;
  publicKey: string;
  privateKey: string;
  clientId: string;
}

export function resolveCwCreds(): { creds: CwCreds | null; source: "store" | "env" | "none" } {
  const stored = getSecret("connectwise");
  if (stored) {
    try {
      const c = JSON.parse(stored) as CwCreds;
      if (c.company && c.publicKey && c.privateKey && c.clientId) {
        return { creds: { ...c, baseUrl: c.baseUrl || config.cwBaseUrl }, source: "store" };
      }
    } catch {
      /* fall through to env */
    }
  }
  if (config.cwCompany && config.cwPublicKey && config.cwPrivateKey && config.cwClientId) {
    return {
      creds: {
        baseUrl: config.cwBaseUrl,
        company: config.cwCompany,
        publicKey: config.cwPublicKey,
        privateKey: config.cwPrivateKey,
        clientId: config.cwClientId,
      },
      source: "env",
    };
  }
  return { creds: null, source: "none" };
}

/**
 * Refuses anything but a real `https://` ConnectWise host (security review,
 * INIT-0026 Phase 3) — every CW call sends the Basic-auth key pair to
 * whatever `baseUrl` is stored, unvalidated before this, so an
 * `integrations.write` holder could otherwise redirect that credential-
 * bearing traffic (now including document uploads) to an arbitrary or even
 * plaintext host and exfiltrate the keys.
 */
function assertValidCwBaseUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("ConnectWise base URL must be a valid URL");
  }
  if (parsed.protocol !== "https:") throw new Error("ConnectWise base URL must use https://");
}

/** Merge a partial credential update over the current set and store it encrypted. */
export function saveCwCreds(input: Partial<CwCreds>) {
  const existing = resolveCwCreds().creds ?? { baseUrl: config.cwBaseUrl, company: "", publicKey: "", privateKey: "", clientId: "" };
  if (input.baseUrl) assertValidCwBaseUrl(input.baseUrl);
  const merged: CwCreds = {
    baseUrl: input.baseUrl || existing.baseUrl,
    company: input.company || existing.company,
    publicKey: input.publicKey || existing.publicKey,
    privateKey: input.privateKey || existing.privateKey,
    clientId: input.clientId || existing.clientId,
  };
  setSecret("connectwise", JSON.stringify(merged));
}

export function mask(s: string): string {
  if (!s) return "";
  return s.length <= 4 ? "••••" : "••••" + s.slice(-4);
}

/**
 * Multi-instance credential resolution (INIT-0026's Logistics rebuild).
 * Separate secret slot per instance (`connectwise:{instanceId}`) so
 * production and sandbox credentials never collide. The single-instance
 * functions above are untouched and keep working exactly as before for
 * every existing caller (vessel tracking, shipment tracking) -- this is
 * additive, not a replacement.
 */
export function resolveCwCredsForInstance(instanceId: string): { creds: CwCreds | null; source: "store" | "none" } {
  const stored = getSecret(`connectwise:${instanceId}`);
  if (stored) {
    try {
      const c = JSON.parse(stored) as CwCreds;
      if (c.company && c.publicKey && c.privateKey && c.clientId) {
        return { creds: { ...c, baseUrl: c.baseUrl || config.cwBaseUrl }, source: "store" };
      }
    } catch {
      /* fall through to none */
    }
  }
  return { creds: null, source: "none" };
}

export function saveCwCredsForInstance(instanceId: string, input: Partial<CwCreds>) {
  const existing = resolveCwCredsForInstance(instanceId).creds ?? {
    baseUrl: config.cwBaseUrl,
    company: "",
    publicKey: "",
    privateKey: "",
    clientId: "",
  };
  if (input.baseUrl) assertValidCwBaseUrl(input.baseUrl);
  const merged: CwCreds = {
    baseUrl: input.baseUrl || existing.baseUrl,
    company: input.company || existing.company,
    publicKey: input.publicKey || existing.publicKey,
    privateKey: input.privateKey || existing.privateKey,
    clientId: input.clientId || existing.clientId,
  };
  setSecret(`connectwise:${instanceId}`, JSON.stringify(merged));
}
