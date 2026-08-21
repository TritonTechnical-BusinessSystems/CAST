/**
 * Deploy trigger (INIT-0035) — "Redeploy"/"Update from git + Redeploy" on
 * the System Health page. This route never touches Docker or git itself; it
 * only calls the deploy-agent container's narrow, authenticated action
 * surface (deploy/deployAgentClient.ts). Gated on `system.deploy`, a
 * strictly admin-only permission (not bundled into `operator`/`viewer` in
 * auth/permissions.ts) — stricter than `integrations.write`, since this
 * triggers real host-level code execution, not just a credential change.
 *
 * Each successful trigger also returns a `watchUrl` (INIT-0038) pointing at
 * the `deploy-monitor` container, which stays up while `api`/`web` restart.
 * The watch token is minted here, AFTER the permission check, so possession of
 * it always means an admin started this deploy.
 */
import { Router } from "express";
import { requirePermission } from "../middleware/auth";
import {
  deployAgentConfigured,
  deployMonitorConfigured,
  getDeployStatus,
  getMonitorVersion,
  triggerDeploy,
  type DeployAction,
} from "../deploy/deployAgentClient";

const router = Router();

router.get("/deploy/status", requirePermission("system.deploy"), async (_req, res) => {
  if (!deployAgentConfigured()) return void res.json({ configured: false });
  // Fetched alongside the deploy status so the Monitor tile and the Deploy card
  // stay consistent on one poll rather than drifting between two.
  const monitor = await getMonitorVersion().catch(() => null);
  try {
    const { ok, status, data } = await getDeployStatus();
    if (!ok) {
      return void res
        .status(502)
        .json({ configured: true, monitorConfigured: deployMonitorConfigured(), monitor, error: `Deploy agent returned ${status}` });
    }
    res.json({ configured: true, monitorConfigured: deployMonitorConfigured(), monitor, ...data });
  } catch (e) {
    res.status(502).json({
      configured: true,
      monitorConfigured: deployMonitorConfigured(),
      monitor,
      error: e instanceof Error ? e.message : "Deploy agent unreachable",
    });
  }
});

/**
 * Shared handler for all three trigger actions. `action` is chosen from a
 * literal in each route below — never read from the request — so no caller
 * input reaches the agent's own action table.
 *
 * Caller identity is logged for audit (who triggered the most powerful action
 * in the app — security review, 2026-08-21 found no record at all),
 * display-only on the agent side, never used to build a command or path.
 */
function triggerRoute(action: DeployAction) {
  return async (req: Parameters<Parameters<typeof router.post>[1]>[0], res: Parameters<Parameters<typeof router.post>[1]>[1]) => {
    if (!deployAgentConfigured()) return void res.status(400).json({ ok: false, detail: "Deploy agent not configured" });
    const who = req.user?.displayName ?? req.user?.id ?? "unknown";
    console.log(`[system.deploy] ${action} triggered by ${req.user?.displayName ?? "unknown"} (${req.user?.id ?? "?"})`);
    try {
      res.json(await triggerDeploy(action, who));
    } catch (e) {
      res.status(502).json({ ok: false, detail: e instanceof Error ? e.message : "Deploy agent unreachable" });
    }
  };
}

router.post("/deploy/redeploy", requirePermission("system.deploy"), triggerRoute("redeploy"));
router.post("/deploy/update-and-redeploy", requirePermission("system.deploy"), triggerRoute("update-and-redeploy"));
// Rebuilds `deploy-monitor` only. Separate from a normal redeploy because
// deploy.sh is scoped to `api web` — the monitor is deliberately excluded so a
// routine deploy can't restart it mid-stream, which leaves this as the only
// way to pick up a change to it without an SSH session (INIT-0038).
router.post("/deploy/update-monitor", requirePermission("system.deploy"), triggerRoute("update-monitor"));

export default router;
