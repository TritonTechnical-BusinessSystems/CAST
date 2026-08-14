/**
 * Integrations — in-app credential management (INIT-0013). GET reports status +
 * MASKED hints only (never the secret); POST saves encrypted; test runs a live
 * CW call. The SPA can write/update creds but never reads a plaintext secret back.
 */
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { config, isCwWritesEnabled, setCwWritesEnabled } from "../config";
import { resolveCwCreds, saveCwCreds, resolveCwCredsForInstance, saveCwCredsForInstance, mask } from "../connectwise/creds";
import { getSystemInfo } from "../connectwise/manageClient";
import { assertValidCwInstance } from "../connectwise/instances";

const router = Router();

function requireInstance(instanceId: string, res: import("express").Response): boolean {
  try {
    assertValidCwInstance(instanceId);
    return true;
  } catch (e) {
    res.status(404).json({ error: e instanceof Error ? e.message : "Unknown CW instance" });
    return false;
  }
}

router.get("/connectwise", requireAuth, (_req, res) => {
  const { creds, source } = resolveCwCreds();
  res.json({
    configured: Boolean(creds),
    company: creds?.company ?? "",
    baseUrl: creds?.baseUrl ?? config.cwBaseUrl,
    publicKeyMasked: creds ? mask(creds.publicKey) : "",
    clientIdMasked: creds ? mask(creds.clientId) : "",
    imoField: config.cwImoFieldCaption,
    mmsiField: config.cwMmsiFieldCaption,
    writesEnabled: isCwWritesEnabled(),
    source,
  });
});

// The safety-gate toggle itself — same admin-only tier as saving credentials.
router.put("/connectwise/writes", requirePermission("integrations.write"), (req, res) => {
  const { enabled } = (req.body ?? {}) as { enabled?: unknown };
  if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be a boolean" });
  setCwWritesEnabled(enabled);
  res.json({ writesEnabled: isCwWritesEnabled() });
});

router.post("/connectwise/test", requireAuth, async (_req, res) => {
  try {
    const info = await getSystemInfo();
    res.json({ ok: true, detail: `ConnectWise ${info.version}` });
  } catch (e) {
    res.json({ ok: false, detail: e instanceof Error ? e.message : "Connection failed" });
  }
});

router.post("/connectwise", requirePermission("integrations.write"), (req, res) => {
  const { company, publicKey, privateKey, clientId, baseUrl } = (req.body ?? {}) as Record<string, string>;
  if (!company && !publicKey && !privateKey && !clientId && !baseUrl) {
    return res.status(400).json({ error: "Provide at least one credential field to save" });
  }
  try {
    saveCwCreds({ company, publicKey, privateKey, clientId, baseUrl });
  } catch (e) {
    return void res.status(400).json({ error: e instanceof Error ? e.message : "Invalid credentials" });
  }
  res.json({ ok: true });
});

// ── Per-CW-instance credentials (INIT-0026's multi-instance Logistics rebuild) ──
//
// Deliberately separate from the routes above, not a generalization of them —
// the single-instance path above powers vessel/shipment tracking's existing
// `getCwClient()` (no instance argument) and is untouched. These configure
// the encrypted per-instance slots (`connectwise:{instanceId}`) that every
// `/api/logistics/:instance/...` route requires before it will do anything —
// closing the gap where `saveCwCredsForInstance` existed since Phase 0 but no
// route ever called it, so no named instance could actually be configured.

router.get("/:instance/connectwise", requireAuth, (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const { creds, source } = resolveCwCredsForInstance(req.params.instance);
  res.json({
    configured: Boolean(creds),
    company: creds?.company ?? "",
    baseUrl: creds?.baseUrl ?? config.cwBaseUrl,
    publicKeyMasked: creds ? mask(creds.publicKey) : "",
    clientIdMasked: creds ? mask(creds.clientId) : "",
    source,
  });
});

router.post("/:instance/connectwise", requirePermission("integrations.write"), (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const { company, publicKey, privateKey, clientId, baseUrl } = (req.body ?? {}) as Record<string, string>;
  if (!company && !publicKey && !privateKey && !clientId && !baseUrl) {
    return void res.status(400).json({ error: "Provide at least one credential field to save" });
  }
  try {
    saveCwCredsForInstance(req.params.instance, { company, publicKey, privateKey, clientId, baseUrl });
  } catch (e) {
    return void res.status(400).json({ error: e instanceof Error ? e.message : "Invalid credentials" });
  }
  res.json({ ok: true });
});

export default router;
