/**
 * Integrations — in-app credential management (INIT-0013). GET reports status +
 * MASKED hints only (never the secret); POST saves encrypted; test runs a live
 * CW call. The SPA can write/update creds but never reads a plaintext secret back.
 */
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { config, isCwWritesEnabled, setCwWritesEnabled } from "../config";
import { resolveCwCreds, saveCwCreds, mask } from "../connectwise/creds";
import { getSystemInfo } from "../connectwise/manageClient";

const router = Router();

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
  saveCwCreds({ company, publicKey, privateKey, clientId, baseUrl });
  res.json({ ok: true });
});

export default router;
