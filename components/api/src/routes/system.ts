/**
 * Deploy trigger (INIT-0035) — "Redeploy"/"Update from git + Redeploy" on
 * the System Health page. This route never touches Docker or git itself; it
 * only calls the deploy-agent container's narrow, authenticated action
 * surface (deploy/deployAgentClient.ts). Gated on `system.deploy`, a
 * strictly admin-only permission (not bundled into `operator`/`viewer` in
 * auth/permissions.ts) — stricter than `integrations.write`, since this
 * triggers real host-level code execution, not just a credential change.
 */
import { Router } from "express";
import { requirePermission } from "../middleware/auth";
import { deployAgentConfigured, getDeployStatus, triggerRedeploy } from "../deploy/deployAgentClient";

const router = Router();

router.get("/deploy/status", requirePermission("system.deploy"), async (_req, res) => {
  if (!deployAgentConfigured()) return void res.json({ configured: false });
  try {
    const { ok, status, data } = await getDeployStatus();
    if (!ok) return void res.status(502).json({ configured: true, error: `Deploy agent returned ${status}` });
    res.json({ configured: true, ...data });
  } catch (e) {
    res.status(502).json({ configured: true, error: e instanceof Error ? e.message : "Deploy agent unreachable" });
  }
});

// Caller identity is logged for audit (who triggered the most powerful
// action in the app — security review, 2026-08-21 found no record at all),
// display-only on the agent side, never used to build a command or path.
router.post("/deploy/redeploy", requirePermission("system.deploy"), async (req, res) => {
  if (!deployAgentConfigured()) return void res.status(400).json({ ok: false, detail: "Deploy agent not configured" });
  console.log(`[system.deploy] redeploy triggered by ${req.user?.displayName ?? "unknown"} (${req.user?.id ?? "?"})`);
  try {
    res.json(await triggerRedeploy(false, req.user?.displayName ?? req.user?.id ?? "unknown"));
  } catch (e) {
    res.status(502).json({ ok: false, detail: e instanceof Error ? e.message : "Deploy agent unreachable" });
  }
});

router.post("/deploy/update-and-redeploy", requirePermission("system.deploy"), async (req, res) => {
  if (!deployAgentConfigured()) return void res.status(400).json({ ok: false, detail: "Deploy agent not configured" });
  console.log(`[system.deploy] update-and-redeploy triggered by ${req.user?.displayName ?? "unknown"} (${req.user?.id ?? "?"})`);
  try {
    res.json(await triggerRedeploy(true, req.user?.displayName ?? req.user?.id ?? "unknown"));
  } catch (e) {
    res.status(502).json({ ok: false, detail: e instanceof Error ? e.message : "Deploy agent unreachable" });
  }
});

export default router;
