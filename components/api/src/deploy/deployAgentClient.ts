/**
 * Client for the deploy-agent container (INIT-0035) — this process never
 * holds the Docker socket or the git deploy key itself; it only ever calls
 * the agent's two fixed, authenticated actions. See
 * components/deploy-agent/server.js for the other side of this contract.
 */
import { config } from "../config";

export interface DeployAgentStatus {
  status: "idle" | "running" | "done";
  action: "redeploy" | "update-and-redeploy" | null;
  triggeredBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  log: string;
}

export function deployAgentConfigured(): boolean {
  return Boolean(config.deployAgentToken);
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
export async function triggerRedeploy(pull: boolean, triggeredBy: string): Promise<{ ok: boolean; detail: string }> {
  const { ok, status, body } = await call(pull ? "/update-and-redeploy" : "/redeploy", "POST", triggeredBy);
  if (ok) return { ok: true, detail: "Deploy started" };
  if (status === 409) return { ok: false, detail: "A deploy is already running" };
  if (status === 401) return { ok: false, detail: "Deploy agent rejected the request — token mismatch" };
  return { ok: false, detail: `Deploy agent returned ${status}: ${JSON.stringify(body)}` };
}
