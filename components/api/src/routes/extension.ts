/**
 * Extension deployment downloads — the web app serves the force-install installer
 * so a user can grab it and run it manually (the easy initial path; mass GPO/RMM
 * deployment comes later). Files are the canonical ones in
 * components/browser-extension/deploy (single source of truth).
 */
import { Router } from "express";
import type { Response } from "express";
import { readFileSync } from "fs";
import { join } from "path";

const DEPLOY_DIR = join(process.cwd(), "..", "browser-extension", "deploy");

function serve(res: Response, file: string, downloadName: string) {
  try {
    const body = readFileSync(join(DEPLOY_DIR, file), "utf8");
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
    res.send(body);
  } catch {
    res.status(404).json({ error: "Installer not available" });
  }
}

// Public (no auth) — the installer is downloadable from the login page. It
// contains no secrets, only the public extension ID + update URL.
const router = Router();
router.get("/install.ps1", (_req, res) => serve(res, "Install-CAST-Extension.ps1", "Install-CAST-Extension.ps1"));
router.get("/install.reg", (_req, res) => serve(res, "cast-extension.reg", "cast-extension.reg"));

export default router;
