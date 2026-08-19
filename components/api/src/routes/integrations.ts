/**
 * Integrations — in-app credential management (INIT-0013). GET reports status +
 * masked hints only (never a secret key back); POST saves encrypted (partial —
 * a blank/omitted field leaves the existing value untouched, user 2026-08-19);
 * test runs a live CW call; DELETE wipes an instance's stored credentials
 * entirely (the only way to actually remove a leaked key, not just overwrite
 * it). The SPA can write/update creds but never reads a plaintext key back.
 *
 * ConnectWise PSA is ONE integration with N named instances (Production
 * "tritontech", Sandbox "tritontech_cs1", ...) — every route here is instance-
 * scoped, with no default/legacy/no-instance path (removed 2026-08-19, user:
 * "not comfortable with a fallback at all for database access/reads/writes ...
 * if something goes wrong and we fallback to the wrong database, especially
 * the Production one, we're causing real damage to data"). See
 * connectwise/creds.ts for the credential-resolution side of this guarantee.
 */
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { config, isCwWritesEnabled, setCwWritesEnabled } from "../config";
import { resolveCwCredsForInstance, saveCwCredsForInstance, clearCwCredsForInstance, getCredsDisplay } from "../connectwise/creds";
import { getSystemInfo } from "../connectwise/manageClient";
import { listCwInstances, assertValidCwInstance } from "../connectwise/instances";

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

/** Every field is optional (partial save), but if present must be a plain string — rejects arrays/objects/numbers before they reach the encrypted store or a Basic-auth header (pre-release security gate, 2026-08-19). */
function parseCredsBody(body: unknown): { company?: string; publicKey?: string; privateKey?: string; clientId?: string; baseUrl?: string } | null {
  if (typeof body !== "object" || body === null) return {};
  const b = body as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of ["company", "publicKey", "privateKey", "clientId", "baseUrl"] as const) {
    const v = b[key];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string") return null;
    out[key] = v;
  }
  return out;
}

router.get("/instances", requireAuth, (_req, res) => {
  res.json(listCwInstances());
});

// Global config (not a credential, not instance-scoped) — the vessel-identity
// custom-field captions (INIT-0014), shown alongside Production's card since
// that's the only instance IMO/MMSI reconciliation runs against today.
router.get("/vessel-fields", requireAuth, (_req, res) => {
  res.json({ imo: config.cwImoFieldCaption, mmsi: config.cwMmsiFieldCaption });
});

// The writes safety-gate stays a SINGLE global switch, not per-instance —
// it answers "can CAST write to ConnectWise at all right now", orthogonal to
// which instance's credentials are configured.
router.put("/connectwise/writes", requirePermission("integrations.write"), (req, res) => {
  const { enabled } = (req.body ?? {}) as { enabled?: unknown };
  if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be a boolean" });
  setCwWritesEnabled(enabled);
  res.json({ writesEnabled: isCwWritesEnabled() });
});

router.get("/:instance/connectwise", requireAuth, (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  // clientId is NOT part of the Basic-auth secret (it's a separate header
  // identifying the registered CW Developer Network application) — shown
  // unmasked, same trust tier as company/baseUrl, so it can be visibly
  // copied between instances (Sandbox intentionally reuses Production's) and
  // pre-fills its edit form even before the rest of that instance is saved.
  res.json({ ...getCredsDisplay(req.params.instance), writesEnabled: isCwWritesEnabled() });
});

router.post("/:instance/connectwise", requirePermission("integrations.write"), (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const parsed = parseCredsBody(req.body);
  if (parsed === null) return void res.status(400).json({ error: "Credential fields must be plain strings" });
  const { company, publicKey, privateKey, clientId, baseUrl } = parsed;
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

router.delete("/:instance/connectwise", requirePermission("integrations.write"), (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  clearCwCredsForInstance(req.params.instance);
  res.json({ ok: true });
});

// integrations.write, not requireAuth — this returns ConnectWise's own error
// detail verbatim (useful for diagnosing a bad key entry, the whole point of
// a test button), which can carry the API member/company identifier and
// internal CW error codes; that belongs to whoever manages credentials, not
// every authenticated viewer (tightened in the pre-release security gate,
// 2026-08-19 — the legacy single-instance test route this replaces was
// requireAuth-only, a gap this closes rather than carries forward).
router.post("/:instance/connectwise/test", requirePermission("integrations.write"), async (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const creds = resolveCwCredsForInstance(req.params.instance).creds;
  if (!creds) return void res.json({ ok: false, detail: "Not configured" });
  try {
    const info = await getSystemInfo(creds);
    res.json({ ok: true, detail: `ConnectWise ${info.version}` });
  } catch (e) {
    res.json({ ok: false, detail: e instanceof Error ? e.message : "Connection failed" });
  }
});

export default router;
