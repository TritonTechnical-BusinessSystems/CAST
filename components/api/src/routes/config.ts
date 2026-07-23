/**
 * Extension configuration API. Authors the config the browser extension
 * consumes, validated against the shared @cast/config-schema so the contract
 * can't drift (knowledge/decisions/0005).
 *
 * TODO(INIT-0008): persist config (currently in-memory) and add the publish
 * step that pushes it to the extension's artifacts host (INIT-0001).
 */
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { parseCastConfig, type CastConfig } from "@cast/config-schema";

let current: CastConfig = { version: "v0", departments: {}, roles: {} };

const router = Router();

router.get("/", requireAuth, (_req, res) => {
  res.json(current);
});

router.put("/", requireAuth, (req, res) => {
  try {
    current = parseCastConfig(req.body);
    res.json({ ok: true, version: current.version });
  } catch (err) {
    res.status(400).json({ error: "Invalid configuration", detail: String(err) });
  }
});

export default router;
