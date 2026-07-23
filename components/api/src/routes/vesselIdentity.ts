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
import { requireAuth } from "../middleware/auth";
import { checkImo, checkMmsi } from "../vessels/identifiers";
import { registryLinksForImo, registryLinksForName } from "../vessels/registryLinks";
import { getCwClient } from "../connectwise/client";

const router = Router();

/** GET /api/vessel-identity — the reconciliation audit for all tracked vessels. */
router.get("/", requireAuth, async (_req, res) => {
  const cw = getCwClient();
  const vessels = await cw.listTrackedVessels();

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
 * an invalid value is rejected (400) rather than written.
 */
router.post("/:id", requireAuth, async (req, res) => {
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
    const cw = getCwClient();
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
