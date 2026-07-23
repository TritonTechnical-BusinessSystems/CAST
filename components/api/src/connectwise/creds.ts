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

/** Merge a partial credential update over the current set and store it encrypted. */
export function saveCwCreds(input: Partial<CwCreds>) {
  const existing = resolveCwCreds().creds ?? { baseUrl: config.cwBaseUrl, company: "", publicKey: "", privateKey: "", clientId: "" };
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
