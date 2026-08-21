/**
 * Client for the deploy-agent container (INIT-0035) — this process never
 * holds the Docker socket or the git deploy key itself; it only ever calls
 * the agent's two fixed, authenticated actions. See
 * components/deploy-agent/server.js for the other side of this contract.
 */
import { createHmac } from "crypto";
import { config } from "../config";
import { fingerprintMonitorSource } from "./monitorVersion";

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

export interface MonitorVersionInfo {
  /** Whether the monitor container answered at all. */
  reachable: boolean;
  /** Source fingerprint the RUNNING image was built from. */
  runningFingerprint: string | null;
  /** Source fingerprint currently on disk in this deploy. */
  stagedFingerprint: string | null;
  /**
   * True only when both are known AND differ — a newer monitor has shipped
   * with a deploy and is waiting to be built. Never true on "can't tell":
   * a false "update ready" nag is worse than staying quiet.
   */
  updateStaged: boolean;
  startedAt: string | null;
}

/**
 * Compares the running monitor against the monitor source this deploy shipped.
 *
 * A routine deploy git-pulls new monitor source but deliberately never rebuilds
 * that container (`deploy.sh` is scoped to `api web`, so it can't restart the
 * thing reporting on it) — so a new version arrives STAGED and sits unbuilt
 * with nothing surfacing it. This is what makes it visible.
 */
export async function getMonitorVersion(): Promise<MonitorVersionInfo> {
  const staged = fingerprintMonitorSource();
  if (!deployMonitorConfigured()) {
    return { reachable: false, runningFingerprint: null, stagedFingerprint: staged, updateStaged: false, startedAt: null };
  }
  try {
    const res = await fetch(`${config.deployMonitorInternalUrl}/healthz`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`monitor returned ${res.status}`);
    const body = (await res.json()) as { fingerprint?: string | null; startedAt?: string | null };
    const running = body.fingerprint ?? null;
    return {
      reachable: true,
      runningFingerprint: running,
      stagedFingerprint: staged,
      updateStaged: Boolean(running && staged && running !== staged),
      startedAt: body.startedAt ?? null,
    };
  } catch {
    return { reachable: false, runningFingerprint: null, stagedFingerprint: staged, updateStaged: false, startedAt: null };
  }
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
    // NO watch URL for `update-monitor` — that action rebuilds and restarts
    // the monitor itself, so handing the browser to it would land the operator
    // on a page that is torn down underneath them seconds later. The monitor
    // cannot be its own progress display while it is the thing restarting;
    // `update-monitor` stays on System Health and reports through the Deploy
    // card's own status banner instead. (`api`/`web` are untouched by it, so
    // that card stays live throughout — the exact inverse of why a normal
    // redeploy needs the monitor at all.)
    const watchUrl = action === "update-monitor" ? null : buildWatchUrl();
    return { ok: true, detail: action === "update-monitor" ? "Monitor update started" : "Deploy started", ...(watchUrl ? { watchUrl } : {}) };
  }
  if (status === 409) return { ok: false, detail: "A deploy is already running" };
  if (status === 401) return { ok: false, detail: "Deploy agent rejected the request — token mismatch" };
  if (status === 403) return { ok: false, detail: "Deploy agent refused: this credential is read-only" };
  return { ok: false, detail: `Deploy agent returned ${status}: ${JSON.stringify(body)}` };
}
