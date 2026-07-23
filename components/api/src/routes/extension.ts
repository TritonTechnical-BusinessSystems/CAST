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

const EXT_ID = "cijknnchejganljdmpdmdkajcmknmdpp";
const CRX_URL = "https://cast.tritontechnical.com/api/extension/cast.crx";
const EXT_VERSION = process.env.CAST_EXT_VERSION ?? "0.0.3";

// Public (no auth) — the installer + update surface are fetched anonymously by
// the browser / login page. No secrets, only the public extension ID + URLs.
const router = Router();
router.get("/install.bat", (_req, res) => serve(res, "Install-CAST.bat", "Install-CAST.bat"));
router.get("/install.ps1", (_req, res) => serve(res, "Install-CAST-Extension.ps1", "Install-CAST-Extension.ps1"));
router.get("/install.reg", (_req, res) => serve(res, "cast-extension.reg", "cast-extension.reg"));

// The self-hosted update manifest Chrome/Edge poll (served from the app itself —
// internal users' browsers reach it, no separate public host needed).
router.get("/update.xml", (_req, res) => {
  res.setHeader("Content-Type", "application/xml");
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">\n` +
      `  <app appid="${EXT_ID}">\n` +
      `    <updatecheck codebase="${CRX_URL}" version="${EXT_VERSION}" />\n` +
      `  </app>\n` +
      `</gupdate>\n`,
  );
});

// The signed package. Built + placed at deploy/cast.crx by the pack step (INIT-0001).
router.get("/cast.crx", (_req, res) => {
  try {
    const buf = readFileSync(join(DEPLOY_DIR, "cast.crx"));
    res.setHeader("Content-Type", "application/x-chrome-extension");
    res.send(buf);
  } catch {
    res.status(404).json({ error: "Extension package not built yet (INIT-0001)" });
  }
});

export default router;
