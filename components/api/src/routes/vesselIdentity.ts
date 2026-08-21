/**
 * Vessel identity reconciliation (INIT-0014) — audit each tracked vessel for a
 * valid IMO + MMSI, offer app-assisted lookup links for gaps, and write back a
 * confirmed identifier. CAST's first ConnectWise write path.
 *
 * Design law: the operator confirms each identity in the UI; the server
 * re-validates (never trusts client input) before writing, and never acts on an
 * unconfirmed/invalid value.
 */
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { checkImo, checkMmsi } from "../vessels/identifiers";
import { registryLinksForImo, registryLinksForName } from "../vessels/registryLinks";
import { getCwClient } from "../connectwise/client";

const router = Router();

// Vessel identity reconciliation is a Production-only concept — see
// tracking.ts's CW_INSTANCE comment for why this is a literal, not a
// "default instance" lookup.
const CW_INSTANCE = "tritontech";

/** GET /api/vessel-identity — the reconciliation audit for all tracked vessels. */
router.get("/", requireAuth, async (_req, res) => {
  // try/catch is load-bearing, not defensive style: this route previously
  // could never throw (StubCwClient always answered), but now that the
  // encrypted store is the sole source of truth, an unconfigured/rotated
  // instance or any CW error (403/429/5xx) rejects here — and Express 4
  // doesn't forward async rejections, so an uncaught one takes down the
  // whole API process (no error middleware, no unhandledRejection handler
  // registered). Found in the pre-release security gate, 2026-08-19.
  let vessels;
  try {
    const cw = getCwClient(CW_INSTANCE);
    vessels = await cw.listTrackedVessels();
  } catch (e) {
    return void res.status(502).json({ error: e instanceof Error ? e.message : "ConnectWise query failed" });
  }

  const audit = vessels.map((v) => {
    const imo = checkImo(v.imo);
    const mmsi = checkMmsi(v.mmsi);
    const needsAttention = !imo.valid || !mmsi.valid;

    // Lookup is primarily IMO→MMSI; fall back to name when the IMO is unusable.
    const lookupLinks = needsAttention
      ? imo.valid && imo.normalized
        ? registryLinksForImo(imo.normalized)
        : registryLinksForName(v.vesselName)
      : [];

    return {
      id: v.id,
      companyName: v.companyName,
      vesselName: v.vesselName,
      status: v.status,
      imo,
      mmsi,
      needsAttention,
      lookupLinks,
    };
  });

  res.json({
    vessels: audit,
    summary: {
      total: audit.length,
      complete: audit.filter((a) => !a.needsAttention).length,
      needsAttention: audit.filter((a) => a.needsAttention).length,
    },
  });
});

/**
 * POST /api/vessel-identity/:id — set a confirmed IMO and/or MMSI on one
 * vessel. Body: { imo?, mmsi? }. Each supplied value is validated server-side;
 * an invalid value is rejected (400) rather than written. Gated on
 * vessel.reconcile (was only requireAuth — any authenticated viewer could
 * write, relying solely on the CW-writes safety gate
 * (isCwWritesEnabledForInstance), not the permission system. Fixed while
 * adding the quick-entry page below.)
 */
router.post("/:id", requirePermission("vessel.reconcile"), async (req, res) => {
  const { imo, mmsi } = (req.body ?? {}) as { imo?: string; mmsi?: string };
  if (imo === undefined && mmsi === undefined) {
    return res.status(400).json({ error: "Provide imo and/or mmsi" });
  }

  const patch: { imo?: string; mmsi?: string } = {};

  if (imo !== undefined) {
    const c = checkImo(imo);
    if (!c.valid || !c.normalized) return res.status(400).json({ error: c.reason ?? "Invalid IMO", field: "imo" });
    patch.imo = c.normalized;
  }
  if (mmsi !== undefined) {
    const c = checkMmsi(mmsi);
    if (!c.valid || !c.normalized) return res.status(400).json({ error: c.reason ?? "Invalid MMSI", field: "mmsi" });
    patch.mmsi = c.normalized;
  }

  try {
    const cw = getCwClient(CW_INSTANCE);
    const updated = await cw.setVesselIdentifiers(req.params.id, patch);
    return res.json({
      ok: true,
      vessel: { ...updated, imo: checkImo(updated.imo), mmsi: checkMmsi(updated.mmsi) },
    });
  } catch (err) {
    return res.status(404).json({ error: err instanceof Error ? err.message : "Not found" });
  }
});

export default router;
