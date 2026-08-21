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
import { isCwWritesEnabledForInstance, setCwWritesEnabledForInstance } from "../config";
import { resolveCwCredsForInstance, saveCwCredsForInstance, clearCwCredsForInstance, getCredsDisplay } from "../connectwise/creds";
import { getSystemInfo } from "../connectwise/manageClient";
import { listCwInstances, assertValidCwInstance } from "../connectwise/instances";
import { resolveSimpleCreds, saveSimpleCreds, clearSimpleCreds, getSimpleCredsDisplay } from "../integrations/simpleCreds";
import { AISSTREAM_SLOT, AISSTREAM_DEFAULT_WS_URL, restartAisListenerForNewCreds, stopAisListener, testAisstreamCreds, assertValidAisstreamUrl } from "../vessels/aisListener";
import { TRACKINGMORE_SLOT, TRACKINGMORE_DEFAULT_BASE_URL, assertValidTrackingmoreUrl } from "../integrations/trackingmore";

const router = Router();

/** `apiKey`/`url` are both optional (partial save) but must be plain strings — same rule as `parseCredsBody` below. */
function parseSimpleCredsBody(body: unknown): { apiKey?: string; url?: string } | null {
  if (typeof body !== "object" || body === null) return {};
  const b = body as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of ["apiKey", "url"] as const) {
    const v = b[key];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string") return null;
    out[key] = v;
  }
  return out;
}

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

// The writes safety-gate is PER INSTANCE (2026-08-20, user: "The toggle for
// CW writes should be per instance, not global" — a single global switch
// meant enabling writes to test against Sandbox also silently enabled real
// writes to Production, exactly the cross-instance risk this integration's
// whole no-fallback design otherwise closes).
router.put("/:instance/connectwise/writes", requirePermission("integrations.write"), (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const { enabled } = (req.body ?? {}) as { enabled?: unknown };
  if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be a boolean" });
  setCwWritesEnabledForInstance(req.params.instance, enabled);
  res.json({ writesEnabled: isCwWritesEnabledForInstance(req.params.instance) });
});

router.get("/:instance/connectwise", requireAuth, (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  // clientId is NOT part of the Basic-auth secret (it's a separate header
  // identifying the registered CW Developer Network application) — shown
  // unmasked, same trust tier as company/baseUrl, so it can be visibly
  // copied between instances (Sandbox intentionally reuses Production's) and
  // pre-fills its edit form even before the rest of that instance is saved.
  res.json({ ...getCredsDisplay(req.params.instance), writesEnabled: isCwWritesEnabledForInstance(req.params.instance) });
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

// --- aisstream.io (single account, no multi-instance concept — INIT-0012) ---

router.get("/aisstream", requireAuth, (_req, res) => {
  res.json(getSimpleCredsDisplay(AISSTREAM_SLOT, AISSTREAM_DEFAULT_WS_URL));
});

router.post("/aisstream", requirePermission("integrations.write"), (req, res) => {
  const parsed = parseSimpleCredsBody(req.body);
  if (parsed === null) return void res.status(400).json({ error: "Fields must be plain strings" });
  if (!parsed.apiKey && !parsed.url) return void res.status(400).json({ error: "Provide at least one field to save" });
  try {
    saveSimpleCreds(AISSTREAM_SLOT, parsed, assertValidAisstreamUrl);
  } catch (e) {
    return void res.status(400).json({ error: e instanceof Error ? e.message : "Invalid credentials" });
  }
  // Editable in-app now (2026-08-20) — a key saved after boot must actually
  // start the listener, not just sit in the store until the next redeploy.
  // Also picks up a ROTATED key on an already-running listener (2026-08-21
  // security review: a key rotation used to silently keep talking to
  // aisstream with the OLD key until the next natural reconnect) by forcing
  // both tiers to reconnect when the listener was already started.
  restartAisListenerForNewCreds();
  res.json({ ok: true });
});

router.delete("/aisstream", requirePermission("integrations.write"), (_req, res) => {
  clearSimpleCreds(AISSTREAM_SLOT);
  stopAisListener();
  res.json({ ok: true });
});

router.post("/aisstream/test", requirePermission("integrations.write"), async (_req, res) => {
  const creds = resolveSimpleCreds(AISSTREAM_SLOT, AISSTREAM_DEFAULT_WS_URL).creds;
  if (!creds) return void res.json({ ok: false, detail: "Not configured" });
  try {
    res.json(await testAisstreamCreds(creds));
  } catch (e) {
    // `new WebSocket(url)` throws SYNCHRONOUSLY inside testAisstreamCreds's
    // executor for an unparseable URL, rejecting the returned promise —
    // Express 4 doesn't forward async rejections and this app registers no
    // unhandledRejection handler, so an uncaught one here crashes the whole
    // API process (security review, 2026-08-21 — the sibling trackingmore
    // route already had this guard, this one didn't).
    res.json({ ok: false, detail: e instanceof Error ? e.message : "Connection failed" });
  }
});

// --- TrackingMore (single account, no multi-instance concept — INIT-0018, not yet built) ---

router.get("/trackingmore", requireAuth, (_req, res) => {
  res.json(getSimpleCredsDisplay(TRACKINGMORE_SLOT, TRACKINGMORE_DEFAULT_BASE_URL));
});

router.post("/trackingmore", requirePermission("integrations.write"), (req, res) => {
  const parsed = parseSimpleCredsBody(req.body);
  if (parsed === null) return void res.status(400).json({ error: "Fields must be plain strings" });
  if (!parsed.apiKey && !parsed.url) return void res.status(400).json({ error: "Provide at least one field to save" });
  try {
    saveSimpleCreds(TRACKINGMORE_SLOT, parsed, assertValidTrackingmoreUrl);
  } catch (e) {
    return void res.status(400).json({ error: e instanceof Error ? e.message : "Invalid credentials" });
  }
  res.json({ ok: true });
});

router.delete("/trackingmore", requirePermission("integrations.write"), (_req, res) => {
  clearSimpleCreds(TRACKINGMORE_SLOT);
  res.json({ ok: true });
});

// integrations.write, not requireAuth — same reasoning as the CW test route above.
router.post("/trackingmore/test", requirePermission("integrations.write"), async (_req, res) => {
  const creds = resolveSimpleCreds(TRACKINGMORE_SLOT, TRACKINGMORE_DEFAULT_BASE_URL).creds;
  if (!creds) return void res.json({ ok: false, detail: "Not configured" });
  try {
    // Cheapest read-only call that proves the key works (verified live
    // 2026-08-13, knowledge/architecture/shipment-tracking-trackingmore.md §1).
    // `redirect: "manual"` — fetch's default (`"follow"`) forwards custom
    // headers (only `Authorization` gets stripped on a cross-origin hop per
    // spec), so a redirect anywhere off `api.trackingmore.com` — even to
    // another *.trackingmore.com host the allowlist trusts — would otherwise
    // hand this real key to wherever it points (security review, 2026-08-21).
    const r = await fetch(`${creds.url}/couriers/all`, { headers: { "Tracking-Api-Key": creds.apiKey }, redirect: "manual" });
    if (r.status >= 300 && r.status < 400) return void res.json({ ok: false, detail: `TrackingMore returned an unexpected redirect (${r.status}) — refusing to follow it` });
    if (!r.ok) return void res.json({ ok: false, detail: `TrackingMore ${r.status}: ${(await r.text()).slice(0, 200)}` });
    const body = (await r.json()) as { data?: unknown[] };
    res.json({ ok: true, detail: `Connected — ${body.data?.length ?? "?"} carriers available` });
  } catch (e) {
    res.json({ ok: false, detail: e instanceof Error ? e.message : "Connection failed" });
  }
});

export default router;
