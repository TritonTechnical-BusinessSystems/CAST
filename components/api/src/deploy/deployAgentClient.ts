/**
 * Client for the deploy-agent container (INIT-0035) — this process never
 * holds the Docker socket or the git deploy key itself; it only ever calls
 * the agent's two fixed, authenticated actions. See
 * components/deploy-agent/server.js for the other side of this contract.
 */
import { createHmac } from "crypto";
import { config } from "../config";

export type DeployAction = "redeploy" | "update-and-redeploy" | "update-monitor";

export interface DeployAgentStatus {
  status: "idle" | "running" | "done";
  action: DeployAction | null;
  triggeredBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  log: string;
}

export function deployAgentConfigured(): boolean {
  return Boolean(config.deployAgentToken);
}

/** The monitor is optional — without a read-only token there's nothing to hand
 *  a watch URL to, and the UI falls back to the in-page card. */
export function deployMonitorConfigured(): boolean {
  return Boolean(config.deployAgentReadonlyToken && config.deployMonitorUrl);
}

const WATCH_TTL_MS = 30 * 60 * 1000;

/**
 * Mint a short-lived watch token for `deploy-monitor` (INIT-0038).
 *
 * Stateless by design: the monitor recomputes this HMAC and checks the expiry,
 * so there's no registration handshake and no shared state to survive a
 * restart. Keyed on the READ-ONLY agent token — the one credential both
 * processes legitimately hold — specifically so the monitor never needs
 * `CAST_JWT_SECRET`. CAST signs sessions with HS256, so a browser-facing
 * container able to verify a session could also forge an admin one; keeping
 * that secret away from it is the entire point of the split.
 *
 * Only ever called AFTER `requirePermission("system.deploy")` has passed, so
 * possession of this token means "an admin started a deploy in the last 30
 * minutes" — it grants nothing but the ability to watch that deploy.
 */
export function mintWatchToken(): string {
  const expiry = Date.now() + WATCH_TTL_MS;
  const sig = createHmac("sha256", config.deployAgentReadonlyToken).update(`watch:${expiry}`).digest("base64url");
  return `${expiry}.${sig}`;
}

/** Absolute URL the browser is sent to when a deploy starts. */
export function buildWatchUrl(): string | null {
  if (!deployMonitorConfigured()) return null;
  return `${config.deployMonitorUrl}/?w=${encodeURIComponent(mintWatchToken())}`;
}

async function call(path: string, method: "GET" | "POST", triggeredBy?: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${config.deployAgentToken}` };
  // Display-only — the agent never uses this for anything but its own log/status
  // output (audit trail: security review, 2026-08-21 found no record of who
  // triggers the most powerful action in the app). Never reaches argv/spawn.
  if (triggeredBy) headers["X-Triggered-By"] = triggeredBy;
  const res = await fetch(`${config.deployAgentUrl}${path}`, { method, headers, signal: AbortSignal.timeout(10_000) });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

export async function getDeployStatus(): Promise<{ ok: boolean; status: number; data: DeployAgentStatus | null }> {
  const { ok, status, body } = await call("/status", "GET");
  return { ok, status, data: ok ? (body as DeployAgentStatus) : null };
}

/** Returns `{ok: false}` (never throws) on a 409 — a deploy already in flight is an expected, user-facing state, not an error. */
export async function triggerDeploy(action: DeployAction, triggeredBy: string): Promise<{ ok: boolean; detail: string; watchUrl?: string }> {
  const { ok, status, body } = await call(`/${action}`, "POST", triggeredBy);
  if (ok) {
    const watchUrl = buildWatchUrl();
    return { ok: true, detail: "Deploy started", ...(watchUrl ? { watchUrl } : {}) };
  }
  if (status === 409) return { ok: false, detail: "A deploy is already running" };
  if (status === 401) return { ok: false, detail: "Deploy agent rejected the request — token mismatch" };
  if (status === 403) return { ok: false, detail: "Deploy agent refused: this credential is read-only" };
  return { ok: false, detail: `Deploy agent returned ${status}: ${JSON.stringify(body)}` };
}
