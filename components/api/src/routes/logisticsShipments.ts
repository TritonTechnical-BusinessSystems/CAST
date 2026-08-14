/**
 * Logistics Phase 2: Outbound Shipment list + Shipment-detail shell.
 *
 * The "list" is a LIVE ConnectWise ticket query (Service + Project tickets
 * matching the Shipping Request filter), not a local table read — this
 * mirrors LogisticsCoordinator's own design exactly (its local `shipments`
 * table only ever holds one row per ticket the user has actually opened,
 * created lazily). See `knowledge/architecture/...` decisions notes in the
 * Phase 2 review for the parts of LC's behavior deliberately NOT ported
 * (the dead `Home.jsx` local-table list page, the unused delete button, the
 * unused `status` column on the local row).
 *
 * Every route is instance-scoped (`/:instance/...`) per INIT-0026's hard
 * safety design — `assertValidCwInstance` throws loudly on an unknown id,
 * caught here and turned into a clean 404 rather than a leaked stack trace.
 */
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { assertValidCwInstance } from "../connectwise/instances";
import { getCwClient } from "../connectwise/client";
import { getInstanceDb } from "../store/instanceDb";

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

// ── Live CW: the Outbound Shipment list itself ─────────────────────────────

router.get("/:instance/cw/shipping-requests", requireAuth, async (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  try {
    const tickets = await getCwClient(req.params.instance).listShippingRequestTickets();
    res.json(tickets);
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "ConnectWise API error" });
  }
});

router.get("/:instance/cw/shipping-requests/product-counts", requireAuth, async (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const idsParam = String(req.query.ids ?? "");
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (ids.length === 0) return void res.json({});
  try {
    const counts = await getCwClient(req.params.instance).getShippingRequestProductCounts(ids);
    res.json(Object.fromEntries(counts));
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "ConnectWise API error" });
  }
});

// ── Live CW: the Shipment detail shell's header ─────────────────────────────

router.get("/:instance/cw/ticket/:id", requireAuth, async (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) return void res.status(400).json({ error: "Invalid ticket id" });
  try {
    const ticket = await getCwClient(req.params.instance).getShipmentTicket(ticketId);
    if (!ticket) return void res.status(404).json({ error: `No CW ticket ${ticketId} found (service or project)` });
    res.json(ticket);
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "ConnectWise API error" });
  }
});

router.get("/:instance/cw/board/:boardId/statuses", requireAuth, async (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const boardId = Number(req.params.boardId);
  if (!Number.isFinite(boardId)) return void res.status(400).json({ error: "Invalid board id" });
  try {
    const statuses = await getCwClient(req.params.instance).listBoardStatuses(boardId);
    res.json(statuses);
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "ConnectWise API error" });
  }
});

router.patch("/:instance/cw/ticket/:id/status", requirePermission("logistics.write"), async (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const ticketId = Number(req.params.id);
  const { ticketType, statusId } = req.body as { ticketType?: "service" | "project"; statusId?: number };
  if (!Number.isFinite(ticketId) || (ticketType !== "service" && ticketType !== "project") || !Number.isFinite(statusId)) {
    return void res.status(400).json({ error: "ticketId, ticketType ('service'|'project'), and statusId are required" });
  }
  try {
    await getCwClient(req.params.instance).updateTicketStatus(ticketId, ticketType, statusId as number);
    res.status(204).end();
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "ConnectWise API error" });
  }
});

// ── Local shadow record (per-instance DB) — created lazily on first detail visit ──

interface ShipmentRow {
  id: string;
  cw_ticket_id: number | null;
  company_id: number | null;
  status: string;
  incoterm: string | null;
  carrier: string | null;
  currency: string;
  awb_number: string | null;
  weight: number | null;
  show_weight_per_item: number;
  consignee_name: string | null;
  consignee_address: string | null;
  ship_to_same_as_consignee: number;
  ship_to_name: string | null;
  ship_to_address: string | null;
  export_statement: string | null;
  ci_flag_id: number | null;
  ci_date: string | null;
  shipper_tax_field: string | null;
  consignee_tax_field: string | null;
  consignee_ein: string | null;
  consignee_vat: string | null;
  consignee_eori: string | null;
  created_at: string;
  updated_at: string;
}

const SHIPMENT_COLUMNS = [
  "cw_ticket_id",
  "company_id",
  "status",
  "incoterm",
  "carrier",
  "currency",
  "awb_number",
  "weight",
  "show_weight_per_item",
  "consignee_name",
  "consignee_address",
  "ship_to_same_as_consignee",
  "ship_to_name",
  "ship_to_address",
  "export_statement",
  "ci_flag_id",
  "ci_date",
  "shipper_tax_field",
  "consignee_tax_field",
  "consignee_ein",
  "consignee_vat",
  "consignee_eori",
] as const;

router.get("/:instance/shipments/:id", requireAuth, (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const row = getInstanceDb(req.params.instance).prepare("SELECT * FROM shipments WHERE id = ?").get(req.params.id) as
    | ShipmentRow
    | undefined;
  if (!row) return void res.status(404).json({ error: "Shipment not found" });
  res.json(row);
});

router.post("/:instance/shipments", requirePermission("logistics.write"), (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const id = String(req.body?.id ?? "").trim();
  // A shipment id IS the CW ticket number by design (never free text) — enforced
  // server-side, not just by the frontend's matching `/^\d+$/` guard, because this
  // id later flows unescaped-by-design into the PDF-render pipeline's internal
  // navigation URL (pdf/render.ts) carrying a privileged internal session cookie;
  // a non-numeric id there could be used to redirect that request elsewhere.
  if (!/^\d+$/.test(id)) return void res.status(400).json({ error: "id must be a numeric CW ticket number" });
  const db = getInstanceDb(req.params.instance);
  const existing = db.prepare("SELECT id FROM shipments WHERE id = ?").get(id);
  if (existing) return void res.status(409).json({ error: `Shipment ${id} already exists` });

  const b = req.body ?? {};
  db.prepare(
    `INSERT INTO shipments (id, company_id, incoterm, carrier, currency, consignee_name, consignee_address,
       ship_to_same_as_consignee, ship_to_name, ship_to_address, export_statement)
     VALUES (@id, @company_id, @incoterm, @carrier, @currency, @consignee_name, @consignee_address,
       @ship_to_same_as_consignee, @ship_to_name, @ship_to_address, @export_statement)`,
  ).run({
    id,
    company_id: b.company_id ?? null,
    incoterm: b.incoterm ?? null,
    carrier: b.carrier ?? null,
    currency: b.currency ?? "USD",
    consignee_name: b.consignee_name ?? null,
    consignee_address: b.consignee_address ?? null,
    ship_to_same_as_consignee: b.ship_to_same_as_consignee === false ? 0 : 1,
    ship_to_name: b.ship_to_name ?? null,
    ship_to_address: b.ship_to_address ?? null,
    export_statement: b.export_statement ?? null,
  });
  const row = db.prepare("SELECT * FROM shipments WHERE id = ?").get(id);
  res.status(201).json(row);
});

router.patch("/:instance/shipments/:id", requirePermission("logistics.write"), (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const db = getInstanceDb(req.params.instance);
  const existing = db.prepare("SELECT id FROM shipments WHERE id = ?").get(req.params.id);
  if (!existing) return void res.status(404).json({ error: "Shipment not found" });

  const body = req.body ?? {};
  const keys = SHIPMENT_COLUMNS.filter((k) => Object.prototype.hasOwnProperty.call(body, k));
  if (keys.length > 0) {
    const setClause = keys.map((k) => `${k} = @${k}`).join(", ");
    // `id` MUST be spread last — better-sqlite3 accepts (and silently uses)
    // extra named parameters, so a body-supplied `id` key would otherwise
    // override the bound WHERE-clause target and let a caller PATCH a
    // different shipment than the one addressed in the URL.
    db.prepare(`UPDATE shipments SET ${setClause} WHERE id = @id`).run({ ...body, id: req.params.id });
  }
  const row = db.prepare("SELECT * FROM shipments WHERE id = ?").get(req.params.id);
  res.json(row);
});

// Ported for parity (LC has this endpoint) but not surfaced in the UI — LC
// itself has no delete/archive button anywhere despite the route existing.
router.delete("/:instance/shipments/:id", requirePermission("logistics.write"), (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  getInstanceDb(req.params.instance).prepare("DELETE FROM shipments WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

export default router;
