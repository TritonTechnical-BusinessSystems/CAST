/**
 * Logistics (INIT-0026's native rebuild of LogisticsCoordinator). Phase 1:
 * Configuration — Branding ("Ship As" companies), Carriers, Currencies,
 * Export Presets, CI Flags (all shared app-level config, ported from LC's
 * MAIN_SCHEMA_SQL into cast.db's logistics_* tables), plus Receiving
 * settings and live PO statuses (per-CW-instance, via the multi-instance
 * `getCwClient(instanceId)` built in Phase 0).
 *
 * The CW-Instance CRUD section LC has in its own Config page is deliberately
 * NOT ported — CAST already has its own instance registry + encrypted
 * credential storage (Phase 0, `connectwise/instances.ts` + `creds.ts`),
 * which is a real improvement over LC's plain-text-in-a-config-table
 * approach (confirmed live during the Playwright baseline capture — LC's
 * CW Instances tab displays API keys unmasked). Reading requires only a
 * valid session (`requireAuth`) — `logistics.read` is a defined permission
 * every current role bundle already holds, but isn't separately enforced
 * per-route today (nothing yet needs to distinguish "signed in" from "can
 * read Logistics specifically"); writing needs `logistics.write`.
 */
import { Router } from "express";
import multer from "multer";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { requireAuth, requirePermission } from "../middleware/auth";
import { db, DATA_DIR } from "../store/db";
import { listCwInstances, assertValidCwInstance } from "../connectwise/instances";
import { getCwClient } from "../connectwise/client";

const router = Router();

router.get("/instances", requireAuth, (_req, res) => {
  res.json(listCwInstances());
});

// ── Incoterms (static list, ported verbatim from LC) ───────────────────────

const INCOTERMS = ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF"];

router.get("/config/incoterms", requireAuth, (_req, res) => {
  res.json(INCOTERMS);
});

// ── Branding ("Ship As" companies) ──────────────────────────────────────────

const LOGO_DIR = join(DATA_DIR, "logos");
mkdirSync(LOGO_DIR, { recursive: true });

const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LOGO_MAX_BYTES } });

router.get("/config/companies", requireAuth, (_req, res) => {
  res.json(db.prepare("SELECT * FROM logistics_companies ORDER BY sort_order, name").all());
});

router.post("/config/companies", requirePermission("logistics.write"), (req, res) => {
  const b = req.body;
  const info = db
    .prepare(
      `INSERT INTO logistics_companies
       (name, address_line1, address_line2, city, state, zip, country, phone, email, tax_id,
        address_block, pdf_code, ein, vat, eori, default_export_statement, primary_color, accent_color, sort_order)
       VALUES (@name, @address_line1, @address_line2, @city, @state, @zip, @country, @phone, @email, @tax_id,
        @address_block, @pdf_code, @ein, @vat, @eori, @default_export_statement, @primary_color, @accent_color, @sort_order)`,
    )
    .run({
      name: b.name,
      address_line1: b.address_line1 ?? null,
      address_line2: b.address_line2 ?? null,
      city: b.city ?? null,
      state: b.state ?? null,
      zip: b.zip ?? null,
      country: b.country ?? null,
      phone: b.phone ?? null,
      email: b.email ?? null,
      tax_id: b.tax_id ?? null,
      address_block: b.address_block ?? null,
      pdf_code: b.pdf_code ?? null,
      ein: b.ein ?? null,
      vat: b.vat ?? null,
      eori: b.eori ?? null,
      default_export_statement: b.default_export_statement ?? null,
      primary_color: b.primary_color ?? null,
      accent_color: b.accent_color ?? null,
      sort_order: b.sort_order ?? 0,
    });
  res.status(201).json(db.prepare("SELECT * FROM logistics_companies WHERE id = ?").get(info.lastInsertRowid));
});

router.put("/config/companies/:id", requirePermission("logistics.write"), (req, res) => {
  const existing = db.prepare("SELECT id FROM logistics_companies WHERE id = ?").get(req.params.id);
  if (!existing) return void res.status(404).json({ error: "Company not found" });
  const b = req.body;
  db.prepare(
    `UPDATE logistics_companies SET
       name=@name, address_line1=@address_line1, address_line2=@address_line2, city=@city, state=@state,
       zip=@zip, country=@country, phone=@phone, email=@email, tax_id=@tax_id, address_block=@address_block,
       pdf_code=@pdf_code, ein=@ein, vat=@vat, eori=@eori, default_export_statement=@default_export_statement,
       primary_color=@primary_color, accent_color=@accent_color, sort_order=@sort_order
     WHERE id=@id`,
  ).run({
    id: req.params.id,
    name: b.name,
    address_line1: b.address_line1 ?? null,
    address_line2: b.address_line2 ?? null,
    city: b.city ?? null,
    state: b.state ?? null,
    zip: b.zip ?? null,
    country: b.country ?? null,
    phone: b.phone ?? null,
    email: b.email ?? null,
    tax_id: b.tax_id ?? null,
    address_block: b.address_block ?? null,
    pdf_code: b.pdf_code ?? null,
    ein: b.ein ?? null,
    vat: b.vat ?? null,
    eori: b.eori ?? null,
    default_export_statement: b.default_export_statement ?? null,
    primary_color: b.primary_color ?? null,
    accent_color: b.accent_color ?? null,
    sort_order: b.sort_order ?? 0,
  });
  res.json(db.prepare("SELECT * FROM logistics_companies WHERE id = ?").get(req.params.id));
});

router.delete("/config/companies/:id", requirePermission("logistics.write"), (req, res) => {
  db.prepare("DELETE FROM logistics_companies WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

router.post("/config/companies/:id/set-default", requirePermission("logistics.write"), (req, res) => {
  const existing = db.prepare("SELECT id FROM logistics_companies WHERE id = ?").get(req.params.id);
  if (!existing) return void res.status(404).json({ error: "Company not found" });
  db.prepare("UPDATE logistics_companies SET is_default = 0").run();
  db.prepare("UPDATE logistics_companies SET is_default = 1 WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

router.post("/config/companies/:id/logo", requirePermission("logistics.write"), upload.single("file"), (req, res) => {
  // Explicit, not incidental (security review) — req.params.id flows directly
  // into a filesystem write path below (company_${id}.${ext}); the existence
  // check against an INTEGER PRIMARY KEY column happens to reject most
  // non-numeric input already, but that's SQLite affinity behavior, not a
  // guarantee — validate the shape directly before it ever reaches a path.
  if (!/^\d+$/.test(req.params.id)) return void res.status(400).json({ error: "Invalid company id" });
  const existing = db.prepare("SELECT id FROM logistics_companies WHERE id = ?").get(req.params.id) as { id: number } | undefined;
  if (!existing) return void res.status(404).json({ error: "Company not found" });
  const file = req.file;
  if (!file) return void res.status(400).json({ error: "No file uploaded" });
  if (!ALLOWED_LOGO_TYPES.has(file.mimetype)) {
    return void res.status(400).json({ error: "Logo must be a PNG, JPEG, GIF, or WebP image" });
  }
  const extFromName = (file.originalname || "logo.png").split(".").pop()?.toLowerCase() ?? "png";
  const ext = ["png", "jpg", "jpeg", "gif", "webp"].includes(extFromName) ? extFromName : "png";
  const filename = `company_${req.params.id}.${ext}`;
  writeFileSync(join(LOGO_DIR, filename), file.buffer);
  db.prepare("UPDATE logistics_companies SET logo_filename = ? WHERE id = ?").run(filename, req.params.id);
  res.json({ logo_filename: filename });
});

router.delete("/config/companies/:id/logo", requirePermission("logistics.write"), (req, res) => {
  const row = db.prepare("SELECT logo_filename FROM logistics_companies WHERE id = ?").get(req.params.id) as
    | { logo_filename: string | null }
    | undefined;
  if (row?.logo_filename) {
    const p = join(LOGO_DIR, row.logo_filename);
    if (existsSync(p)) unlinkSync(p);
  }
  db.prepare("UPDATE logistics_companies SET logo_filename = NULL WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

router.get("/config/companies/:id/logo", requireAuth, (req, res) => {
  const row = db.prepare("SELECT logo_filename FROM logistics_companies WHERE id = ?").get(req.params.id) as
    | { logo_filename: string | null }
    | undefined;
  if (!row?.logo_filename) return void res.status(404).json({ error: "No logo for this company" });
  const p = join(LOGO_DIR, row.logo_filename);
  if (!existsSync(p)) return void res.status(404).json({ error: "Logo file missing" });
  res.sendFile(p);
});

// ── Carriers ─────────────────────────────────────────────────────────────────

router.get("/config/carriers", requireAuth, (_req, res) => {
  res.json(db.prepare("SELECT * FROM logistics_carriers ORDER BY sort_order, name").all());
});

router.post("/config/carriers", requirePermission("logistics.write"), (req, res) => {
  const info = db
    .prepare("INSERT INTO logistics_carriers (name, sort_order) VALUES (?, ?)")
    .run(req.body.name, req.body.sort_order ?? 0);
  res.status(201).json(db.prepare("SELECT * FROM logistics_carriers WHERE id = ?").get(info.lastInsertRowid));
});

router.patch("/config/carriers/:id", requirePermission("logistics.write"), (req, res) => {
  db.prepare("UPDATE logistics_carriers SET name = ? WHERE id = ?").run(req.body.name, req.params.id);
  res.json(db.prepare("SELECT * FROM logistics_carriers WHERE id = ?").get(req.params.id));
});

router.delete("/config/carriers/:id", requirePermission("logistics.write"), (req, res) => {
  db.prepare("DELETE FROM logistics_carriers WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

// ── Currencies ───────────────────────────────────────────────────────────────

router.get("/config/currencies", requireAuth, (_req, res) => {
  res.json(db.prepare("SELECT * FROM logistics_currencies ORDER BY sort_order, code").all());
});

router.post("/config/currencies", requirePermission("logistics.write"), (req, res) => {
  const info = db
    .prepare("INSERT INTO logistics_currencies (code, name, sort_order) VALUES (?, ?, ?)")
    .run(req.body.code, req.body.name, req.body.sort_order ?? 0);
  res.status(201).json(db.prepare("SELECT * FROM logistics_currencies WHERE id = ?").get(info.lastInsertRowid));
});

router.delete("/config/currencies/:id", requirePermission("logistics.write"), (req, res) => {
  db.prepare("DELETE FROM logistics_currencies WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

// ── Export Statement Presets ─────────────────────────────────────────────────

router.get("/config/export-presets", requireAuth, (_req, res) => {
  res.json(db.prepare("SELECT * FROM logistics_export_presets ORDER BY sort_order, name").all());
});

router.post("/config/export-presets", requirePermission("logistics.write"), (req, res) => {
  const info = db
    .prepare("INSERT INTO logistics_export_presets (name, content, sort_order) VALUES (?, ?, ?)")
    .run(req.body.name, req.body.content, req.body.sort_order ?? 0);
  res.status(201).json(db.prepare("SELECT * FROM logistics_export_presets WHERE id = ?").get(info.lastInsertRowid));
});

router.delete("/config/export-presets/:id", requirePermission("logistics.write"), (req, res) => {
  db.prepare("DELETE FROM logistics_export_presets WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

// ── CI Flags ─────────────────────────────────────────────────────────────────

router.get("/config/ci-flags", requireAuth, (_req, res) => {
  res.json(db.prepare("SELECT * FROM logistics_ci_flags ORDER BY sort_order, name").all());
});

router.post("/config/ci-flags", requirePermission("logistics.write"), (req, res) => {
  const { name, content, color, font_size, sort_order } = req.body;
  if (!name?.trim() || !content?.trim()) return void res.status(400).json({ error: "name and content are required" });
  const info = db
    .prepare("INSERT INTO logistics_ci_flags (name, content, color, font_size, sort_order) VALUES (?, ?, ?, ?, ?)")
    .run(name.trim(), content.trim(), color || "#1e3a5f", font_size ?? 9, sort_order ?? 0);
  res.status(201).json(db.prepare("SELECT * FROM logistics_ci_flags WHERE id = ?").get(info.lastInsertRowid));
});

router.put("/config/ci-flags/:id", requirePermission("logistics.write"), (req, res) => {
  const existing = db.prepare("SELECT id FROM logistics_ci_flags WHERE id = ?").get(req.params.id);
  if (!existing) return void res.status(404).json({ error: "Flag not found" });
  const { name, content, color, font_size, sort_order } = req.body;
  if (!name?.trim() || !content?.trim()) return void res.status(400).json({ error: "name and content are required" });
  db.prepare("UPDATE logistics_ci_flags SET name=?, content=?, color=?, font_size=?, sort_order=? WHERE id=?").run(
    name.trim(),
    content.trim(),
    color || "#1e3a5f",
    font_size ?? 9,
    sort_order ?? 0,
    req.params.id,
  );
  res.json(db.prepare("SELECT * FROM logistics_ci_flags WHERE id = ?").get(req.params.id));
});

router.delete("/config/ci-flags/:id", requirePermission("logistics.write"), (req, res) => {
  db.prepare("DELETE FROM logistics_ci_flags WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

// ── Receiving settings + live PO statuses (per-CW-instance) ────────────────
//
// Unlike the shared config sections above, these are genuinely scoped per CW
// instance (PO statuses are CW-instance-specific data) — so, per the
// rebuild plan's hard safety design, the instance is a required URL path
// segment, never inferred or defaulted. `assertValidCwInstance` throws
// loudly on an unknown id before anything else runs.

router.get("/:instance/config/receiving-settings", requireAuth, (req, res) => {
  try {
    assertValidCwInstance(req.params.instance);
  } catch (e) {
    return void res.status(404).json({ error: e instanceof Error ? e.message : "Unknown CW instance" });
  }
  const row = db
    .prepare("SELECT po_status_names, week_begins_on, sync_interval_minutes FROM cw_instances WHERE id = ?")
    .get(req.params.instance) as { po_status_names: string; week_begins_on: number; sync_interval_minutes: number };
  res.json({
    status_names: JSON.parse(row.po_status_names) as string[],
    week_begins_on: row.week_begins_on,
    sync_interval_minutes: row.sync_interval_minutes,
  });
});

router.put("/:instance/config/receiving-settings", requirePermission("logistics.write"), (req, res) => {
  try {
    assertValidCwInstance(req.params.instance);
  } catch (e) {
    return void res.status(404).json({ error: e instanceof Error ? e.message : "Unknown CW instance" });
  }
  const { status_names, week_begins_on, sync_interval_minutes } = req.body;
  if (!Number.isInteger(sync_interval_minutes) || sync_interval_minutes < 1) {
    return void res.status(400).json({ error: "sync_interval_minutes must be at least 1" });
  }
  db.prepare("UPDATE cw_instances SET po_status_names = ?, week_begins_on = ?, sync_interval_minutes = ? WHERE id = ?").run(
    JSON.stringify(status_names ?? []),
    week_begins_on ?? 1,
    sync_interval_minutes,
    req.params.instance,
  );
  res.json({ status_names: status_names ?? [], week_begins_on: week_begins_on ?? 1, sync_interval_minutes });
});

router.get("/:instance/config/po-statuses", requireAuth, async (req, res) => {
  try {
    assertValidCwInstance(req.params.instance);
  } catch (e) {
    return void res.status(404).json({ error: e instanceof Error ? e.message : "Unknown CW instance" });
  }
  try {
    const statuses = await getCwClient(req.params.instance).listPurchaseOrderStatuses();
    res.json(statuses);
  } catch (e) {
    const message = e instanceof Error ? e.message : "ConnectWise API error";
    const status = message.includes("403") ? 403 : 502;
    res.status(status).json({
      error:
        status === 403
          ? 'ConnectWise API key lacks permission for Purchase Order Statuses (procurement/purchaseorderstatuses). Grant this API member\'s security role access to this endpoint in CW, then reload.'
          : message,
    });
  }
});

export default router;
