/**
 * Logistics Phase 3: Document generation (Commercial Invoice / Packing
 * List). Architecture ported exactly from LC's `documents.py` +
 * `pdf_service.py` (`knowledge/architecture/logistics-packing-shipping-behavior-spec.md`
 * §8-9): the PDF is the live `CommercialInvoice`/`PackingList` React
 * component, rendered headlessly by Playwright against this same app's own
 * `/print/ci|pl/:id` routes — not a separate template. The `documents`
 * table is a pure ledger (id/type/filename/generated_at/cw_document_id/
 * posted_at); PDF bytes are never persisted, every download/post-to-cw
 * regenerates from scratch, matching LC exactly.
 *
 * Two known LC bugs are deliberately NOT replicated (spec §9.5/§9.6): the
 * "Reset Field" and "Reset" actions there send an invalid `price_source`
 * enum value that a live database rejects. Here, "no override" is
 * represented as SQL `NULL` (the column has no `NOT NULL`/`DEFAULT`), which
 * the frontend's price precedence already treats as max-sold-equivalent —
 * so a reset can never produce an invalid value in the first place.
 *
 * `cache-products` (LC's CW-catalog-enrichment endpoint) is deliberately
 * deferred to Phase 4 — it exists only to backfill `container_items`/
 * `catalog_item_cache` from live CW product data, which is meaningless
 * before Assembly (Phase 4) can create any container_items to backfill.
 */
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { assertValidCwInstance } from "../connectwise/instances";
import { getCwClient } from "../connectwise/client";
import { getInstanceDb } from "../store/instanceDb";
import { db as appDb } from "../store/db";
import { renderShipmentDocument, type DocType } from "../pdf/render";

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

// ── Shared context builders ─────────────────────────────────────────────────

interface ShipmentRow {
  id: string;
  cw_ticket_id: number | null;
  company_id: number | null;
  incoterm: string | null;
  carrier: string | null;
  currency: string;
  awb_number: string | null;
  weight: number | null;
  show_weight_per_item: number;
  consignee_name: string | null;
  consignee_address: string | null;
  ship_to_same_as_consignee: number;
  export_statement: string | null;
  ci_flag_id: number | null;
  ci_date: string | null;
  shipper_tax_field: string | null;
  consignee_tax_field: string | null;
  consignee_ein: string | null;
  consignee_vat: string | null;
  consignee_eori: string | null;
  [key: string]: unknown;
}

interface RawItemRow {
  id: number;
  cw_product_id: number;
  part_number: string | null;
  description: string | null;
  manufacturer: string | null;
  description_override: string | null;
  unit_of_measure: string | null;
  source_ticket_id: number | null;
  hs_code_override: string | null;
  country_of_origin_override: string | null;
  unit_price: number | null;
  msrp: number | null;
  price_source: string | null;
  manual_price: number | null;
  quantity: number;
  serial_numbers: string | null;
  catalog_item_id: number | null;
  container_id: number;
  container_type: "pallet" | "box";
  container_number: number;
  parent_pallet_id: number | null;
  container_sort_order: number;
}

function getShipmentOr404(db: import("better-sqlite3").Database, id: string): ShipmentRow | null {
  return (db.prepare("SELECT * FROM shipments WHERE id = ?").get(id) as ShipmentRow) ?? null;
}

function getRawItems(db: import("better-sqlite3").Database, shipmentId: string): RawItemRow[] {
  return db
    .prepare(
      `SELECT ci.*, c.id as container_id, c.type as container_type, c.number as container_number,
              c.parent_pallet_id as parent_pallet_id, c.sort_order as container_sort_order
       FROM container_items ci
       JOIN containers c ON c.id = ci.container_id
       WHERE c.shipment_id = ?
       ORDER BY c.sort_order, c.id, ci.id`,
    )
    .all(shipmentId) as RawItemRow[];
}

/** Container id -> its own `number` — needed to resolve a box's PARENT PALLET's number for box_assignments labels (a pallet with no direct items never appears in getRawItems' rows). */
function getContainerNumbers(db: import("better-sqlite3").Database, shipmentId: string): Map<number, number> {
  const rows = db.prepare("SELECT id, number FROM containers WHERE shipment_id = ?").all(shipmentId) as { id: number; number: number }[];
  return new Map(rows.map((r) => [r.id, r.number]));
}

/**
 * "Pieces" = physical top-level units = pallets + standalone (un-palletized)
 * boxes (spec §1/§2: `len(pallets) + len(standalone top-level boxes)`) — a
 * box nested under a pallet is NOT counted separately, and an empty pallet
 * (no items packed on it yet) still counts, so this reads the full
 * `containers` table rather than deriving from item rows.
 */
function getPieceCounts(db: import("better-sqlite3").Database, shipmentId: string): { pieces: number; hasPallets: boolean } {
  const rows = db.prepare("SELECT type, parent_pallet_id FROM containers WHERE shipment_id = ?").all(shipmentId) as {
    type: "pallet" | "box";
    parent_pallet_id: number | null;
  }[];
  const pallets = rows.filter((r) => r.type === "pallet").length;
  const standaloneBoxes = rows.filter((r) => r.type === "box" && r.parent_pallet_id == null).length;
  return { pieces: pallets + standaloneBoxes, hasPallets: pallets > 0 };
}

function getCatalogCache(db: import("better-sqlite3").Database, catalogItemIds: number[]): Map<number, { hs_code: string | null; country_of_origin: string | null }> {
  const map = new Map<number, { hs_code: string | null; country_of_origin: string | null }>();
  if (catalogItemIds.length === 0) return map;
  const placeholders = catalogItemIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT catalog_item_id, hs_code, country_of_origin FROM catalog_item_cache WHERE catalog_item_id IN (${placeholders})`)
    .all(...catalogItemIds) as { catalog_item_id: number; hs_code: string | null; country_of_origin: string | null }[];
  for (const r of rows) map.set(r.catalog_item_id, { hs_code: r.hs_code, country_of_origin: r.country_of_origin });
  return map;
}

/** "P:1 | B:1-25" style range collapsing — only P:N|B:M and bare B:M shapes collapse; bare P:N passes through summed-by-exact-match only (spec §9.8). */
function collapseBoxRanges(labels: { label: string; qty: number }[]): { label: string; qty: number }[] {
  const byExact = new Map<string, number>();
  const boxNumbers = new Map<string, { nums: number[]; qtyByNum: Map<number, number> }>(); // keyed by prefix (e.g. "P:1 | B" or "B")
  const boxRe = /^(P:\d+ \| B|B):(\d+)$/;

  for (const { label, qty } of labels) {
    const m = boxRe.exec(label);
    if (m) {
      const [, prefix, numStr] = m;
      const num = Number(numStr);
      const entry = boxNumbers.get(prefix) ?? { nums: [] as number[], qtyByNum: new Map<number, number>() };
      entry.nums.push(num);
      entry.qtyByNum.set(num, (entry.qtyByNum.get(num) ?? 0) + qty);
      boxNumbers.set(prefix, entry);
    } else {
      byExact.set(label, (byExact.get(label) ?? 0) + qty);
    }
  }

  const out: { label: string; qty: number }[] = [...byExact.entries()].map(([label, qty]) => ({ label, qty }));
  for (const [prefix, { nums, qtyByNum }] of boxNumbers) {
    const sorted = [...new Set(nums)].sort((a, b) => a - b);
    let runStart = sorted[0];
    let runEnd = sorted[0];
    let runQty = qtyByNum.get(sorted[0]) ?? 0;
    const flush = () => {
      const range = runStart === runEnd ? `${runStart}` : `${runStart}-${runEnd}`;
      out.push({ label: `${prefix}:${range}`, qty: runQty });
    };
    for (let i = 1; i < sorted.length; i++) {
      const n = sorted[i];
      if (n === runEnd + 1) {
        runEnd = n;
        runQty += qtyByNum.get(n) ?? 0;
      } else {
        flush();
        runStart = runEnd = n;
        runQty = qtyByNum.get(n) ?? 0;
      }
    }
    flush();
  }
  return out;
}

function labelFor(row: RawItemRow, containerNumbers: Map<number, number>): string {
  if (row.container_type === "box" && row.parent_pallet_id) {
    const palletNumber = containerNumbers.get(row.parent_pallet_id);
    return `P:${palletNumber ?? "?"} | B:${row.container_number}`;
  }
  if (row.container_type === "box") return `B:${row.container_number}`;
  return `P:${row.container_number}`;
}

function buildCiLineItems(db: import("better-sqlite3").Database, rows: RawItemRow[], containerNumbers: Map<number, number>) {
  const cache = getCatalogCache(db, [...new Set(rows.map((r) => r.catalog_item_id).filter((x): x is number => x != null))]);
  const byProduct = new Map<number, RawItemRow[]>();
  for (const r of rows) {
    const list = byProduct.get(r.cw_product_id) ?? [];
    list.push(r);
    byProduct.set(r.cw_product_id, list);
  }
  return [...byProduct.entries()].map(([cwProductId, group]) => {
    const first = group[0];
    const last = group[group.length - 1];
    const prices = group.map((r) => r.unit_price).filter((p): p is number => p != null);
    const cached = first.catalog_item_id != null ? cache.get(first.catalog_item_id) : undefined;
    const serials: string[] = group.flatMap((r) => {
      try {
        return r.serial_numbers ? (JSON.parse(r.serial_numbers) as string[]) : [];
      } catch {
        return [];
      }
    });
    const rawLabels = group.map((r) => ({ label: labelFor(r, containerNumbers), qty: r.quantity }));
    return {
      cw_product_id: cwProductId,
      part_number: first.part_number,
      description: first.description,
      manufacturer: first.manufacturer,
      description_override: first.description_override,
      unit_of_measure: first.unit_of_measure,
      source_ticket_id: first.source_ticket_id,
      hs_code: cached?.hs_code ?? "",
      hs_code_override: first.hs_code_override,
      country_of_origin: cached?.country_of_origin ?? "",
      country_of_origin_override: first.country_of_origin_override,
      unit_price: last.unit_price,
      max_unit_price: prices.length ? Math.max(...prices) : null,
      avg_unit_price: prices.length ? Math.round((prices.reduce((s, p) => s + p, 0) / prices.length) * 10000) / 10000 : null,
      msrp: first.msrp,
      catalog_price: null as number | null, // catalog_item_cache also holds catalog_price; joined below if present
      price_source: first.price_source,
      manual_price: first.manual_price,
      total_qty: group.reduce((s, r) => s + r.quantity, 0),
      serial_numbers: serials,
      box_assignments: collapseBoxRanges(rawLabels),
    };
  });
}

function buildCiContext(instanceId: string, shipment: ShipmentRow) {
  const db = getInstanceDb(instanceId);
  const rows = getRawItems(db, shipment.id);
  const company = shipment.company_id != null ? appDb.prepare("SELECT * FROM logistics_companies WHERE id = ?").get(shipment.company_id) : null;
  const ciFlag = shipment.ci_flag_id != null ? appDb.prepare("SELECT * FROM logistics_ci_flags WHERE id = ?").get(shipment.ci_flag_id) : null;
  const { pieces, hasPallets } = getPieceCounts(db, shipment.id);
  return {
    shipment,
    company: company ?? null,
    pieces,
    has_pallets: hasPallets,
    line_items: buildCiLineItems(db, rows, getContainerNumbers(db, shipment.id)),
    ci_flag: ciFlag ?? null,
    effective_export_statement: shipment.export_statement || (company as { default_export_statement?: string } | null)?.default_export_statement || "",
  };
}

function buildPlItems(group: RawItemRow[]) {
  const byProduct = new Map<number, RawItemRow[]>();
  for (const r of group) {
    const list = byProduct.get(r.cw_product_id) ?? [];
    list.push(r);
    byProduct.set(r.cw_product_id, list);
  }
  return [...byProduct.entries()].map(([cwProductId, rows]) => {
    const first = rows[0];
    const serials = rows
      .flatMap((r) => {
        try {
          return r.serial_numbers ? (JSON.parse(r.serial_numbers) as string[]) : [];
        } catch {
          return [];
        }
      })
      .sort();
    return {
      cw_product_id: cwProductId,
      part_number: first.part_number,
      description: first.description,
      description_override: first.description_override,
      manufacturer: first.manufacturer,
      unit_of_measure: first.unit_of_measure,
      source_ticket_id: first.source_ticket_id,
      total_qty: rows.reduce((s, r) => s + r.quantity, 0),
      serial_numbers: serials,
    };
  });
}

function buildPlContext(instanceId: string, shipment: ShipmentRow) {
  const db = getInstanceDb(instanceId);
  const rows = getRawItems(db, shipment.id);
  const company = shipment.company_id != null ? appDb.prepare("SELECT * FROM logistics_companies WHERE id = ?").get(shipment.company_id) : null;

  const byContainer = new Map<number, RawItemRow[]>();
  for (const r of rows) {
    const list = byContainer.get(r.container_id) ?? [];
    list.push(r);
    byContainer.set(r.container_id, list);
  }
  const containerMeta = new Map<number, RawItemRow>();
  for (const r of rows) if (!containerMeta.has(r.container_id)) containerMeta.set(r.container_id, r);

  const palletContainerIds = [...containerMeta.entries()].filter(([, r]) => r.container_type === "pallet").map(([id]) => id);
  const boxRows = [...containerMeta.entries()].filter(([, r]) => r.container_type === "box");

  const pallets = palletContainerIds
    .map((palletId) => {
      const meta = containerMeta.get(palletId)!;
      const boxesUnderPallet = boxRows.filter(([, r]) => r.parent_pallet_id === palletId);
      return {
        id: palletId,
        number: meta.container_number,
        items: buildPlItems(byContainer.get(palletId) ?? []),
        boxes: boxesUnderPallet.map(([boxId, boxMeta]) => ({
          id: boxId,
          number: boxMeta.container_number,
          items: buildPlItems(byContainer.get(boxId) ?? []),
        })),
      };
    })
    .sort((a, b) => a.number - b.number);

  const standaloneBoxes = boxRows
    .filter(([, r]) => !r.parent_pallet_id)
    .map(([boxId, boxMeta]) => ({ id: boxId, number: boxMeta.container_number, items: buildPlItems(byContainer.get(boxId) ?? []) }))
    .sort((a, b) => a.number - b.number);

  const { pieces, hasPallets } = getPieceCounts(db, shipment.id);
  return {
    shipment,
    company: company ?? null,
    pieces,
    has_pallets: hasPallets,
    pallets,
    standalone_boxes: standaloneBoxes,
  };
}

// ── Data endpoints (consumed both interactively and by the print pages) ────

router.get("/:instance/documents/:id/invoice-data", requireAuth, (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const shipment = getShipmentOr404(getInstanceDb(req.params.instance), req.params.id);
  if (!shipment) return void res.status(404).json({ error: "Shipment not found" });
  res.json(buildCiContext(req.params.instance, shipment));
});

router.get("/:instance/documents/:id/packing-list-data", requireAuth, (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const shipment = getShipmentOr404(getInstanceDb(req.params.instance), req.params.id);
  if (!shipment) return void res.status(404).json({ error: "Shipment not found" });
  res.json(buildPlContext(req.params.instance, shipment));
});

// ── Line-item overrides (fan out to every container_item sharing the product) ──

router.patch("/:instance/documents/:id/line-item/:cwProductId", requirePermission("logistics.write"), (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const db = getInstanceDb(req.params.instance);
  const shipment = getShipmentOr404(db, req.params.id);
  if (!shipment) return void res.status(404).json({ error: "Shipment not found" });

  const b = req.body ?? {};
  const allowed = ["description_override", "hs_code_override", "country_of_origin_override", "price_source", "manual_price"] as const;
  const keys = allowed.filter((k) => Object.prototype.hasOwnProperty.call(b, k));
  if (keys.length === 0) return void res.status(400).json({ error: "No recognized override fields in body" });
  if ("price_source" in b && b.price_source != null && !["max_sold", "avg_sold", "catalog_price", "catalog_msrp", "manual"].includes(b.price_source)) {
    return void res.status(400).json({ error: "Invalid price_source" });
  }
  const setClause = keys.map((k) => `${k} = @${k}`).join(", ");
  db.prepare(
    `UPDATE container_items SET ${setClause} WHERE cw_product_id = @cwProductId AND container_id IN (SELECT id FROM containers WHERE shipment_id = @shipmentId)`,
  ).run({ ...b, cwProductId: Number(req.params.cwProductId), shipmentId: req.params.id });
  const lineItems = buildCiLineItems(db, getRawItems(db, req.params.id), getContainerNumbers(db, req.params.id));
  res.json(lineItems.find((li) => li.cw_product_id === Number(req.params.cwProductId)) ?? null);
});

// Reset does NOT replicate LC's two live bugs (spec §9.5/§9.6) — NULL, not
// an invalid enum literal, represents "no override" (see file header).
router.post("/:instance/documents/:id/reset-ci-overrides", requirePermission("logistics.write"), (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const db = getInstanceDb(req.params.instance);
  const shipment = getShipmentOr404(db, req.params.id);
  if (!shipment) return void res.status(404).json({ error: "Shipment not found" });

  db.prepare(
    `UPDATE container_items SET description_override = NULL, hs_code_override = NULL, country_of_origin_override = NULL,
       price_source = NULL, manual_price = NULL
     WHERE container_id IN (SELECT id FROM containers WHERE shipment_id = ?)`,
  ).run(req.params.id);
  db.prepare(
    `UPDATE shipments SET consignee_name = NULL, consignee_address = NULL, ship_to_same_as_consignee = 1,
       export_statement = NULL, ci_date = NULL, shipper_tax_field = NULL, consignee_tax_field = NULL,
       consignee_ein = NULL, consignee_vat = NULL, consignee_eori = NULL, incoterm = NULL, carrier = NULL,
       currency = 'USD', awb_number = NULL, weight = NULL
     WHERE id = ?`,
  ).run(req.params.id);
  res.json(getShipmentOr404(db, req.params.id));
});

// ── Document ledger + generate/download/post-to-cw ──────────────────────────

interface DocumentRow {
  id: number;
  shipment_id: string;
  doc_type: "packing_list" | "commercial_invoice";
  pdf_filename: string;
  generated_at: string;
  cw_document_id: number | null;
  posted_at: string | null;
}

function docTypeSlug(doc: "packing_list" | "commercial_invoice"): DocType {
  return doc === "commercial_invoice" ? "commercial-invoice" : "packing-list";
}

function makeFilename(shipmentId: string, docType: "packing_list" | "commercial_invoice", pdfCode: string | null): string {
  const suffix = docType === "commercial_invoice" ? "CI" : "PL";
  return pdfCode ? `${shipmentId}-${pdfCode}-${suffix}.pdf` : `${shipmentId}-${suffix}.pdf`;
}

router.get("/:instance/documents/:id", requireAuth, (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const rows = getInstanceDb(req.params.instance)
    .prepare("SELECT * FROM documents WHERE shipment_id = ? ORDER BY generated_at DESC")
    .all(req.params.id);
  res.json(rows);
});

router.post("/:instance/documents/:id/:docType(commercial-invoice|packing-list)/generate", requirePermission("logistics.write"), async (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const db = getInstanceDb(req.params.instance);
  const shipment = getShipmentOr404(db, req.params.id);
  if (!shipment) return void res.status(404).json({ error: "Shipment not found" });
  const docType: "packing_list" | "commercial_invoice" = req.params.docType === "commercial-invoice" ? "commercial_invoice" : "packing_list";
  const company = shipment.company_id != null ? (appDb.prepare("SELECT * FROM logistics_companies WHERE id = ?").get(shipment.company_id) as { name?: string; pdf_code?: string } | undefined) : undefined;

  try {
    await renderShipmentDocument(docTypeSlug(docType), req.params.instance, req.params.id, {
      companyName: company?.name ?? "",
      docRef: `${shipment.id}${company?.pdf_code ? `-${company.pdf_code}` : ""}`,
    });
  } catch (e) {
    return void res.status(502).json({ error: e instanceof Error ? e.message : "PDF generation failed" });
  }

  const filename = makeFilename(req.params.id, docType, company?.pdf_code ?? null);
  const info = db
    .prepare("INSERT INTO documents (shipment_id, doc_type, pdf_filename) VALUES (?, ?, ?)")
    .run(req.params.id, docType, filename);
  res.status(201).json(db.prepare("SELECT * FROM documents WHERE id = ?").get(info.lastInsertRowid));
});

router.get("/:instance/documents/download/:documentId", requireAuth, async (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const db = getInstanceDb(req.params.instance);
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.documentId) as DocumentRow | undefined;
  if (!doc) return void res.status(404).json({ error: "Document not found" });
  const shipment = getShipmentOr404(db, doc.shipment_id);
  const company = shipment?.company_id != null ? (appDb.prepare("SELECT * FROM logistics_companies WHERE id = ?").get(shipment.company_id) as { name?: string; pdf_code?: string } | undefined) : undefined;

  try {
    const pdf = await renderShipmentDocument(docTypeSlug(doc.doc_type), req.params.instance, doc.shipment_id, {
      companyName: company?.name ?? "",
      docRef: `${doc.shipment_id}${company?.pdf_code ? `-${company.pdf_code}` : ""}`,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${doc.pdf_filename}"`);
    res.send(pdf);
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "PDF generation failed" });
  }
});

router.post("/:instance/documents/:documentId/post-to-cw", requirePermission("logistics.write"), async (req, res) => {
  if (!requireInstance(req.params.instance, res)) return;
  const db = getInstanceDb(req.params.instance);
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.documentId) as DocumentRow | undefined;
  if (!doc) return void res.status(404).json({ error: "Document not found" });
  const shipment = getShipmentOr404(db, doc.shipment_id);
  if (!shipment) return void res.status(404).json({ error: "Shipment not found" });
  const company = shipment.company_id != null ? (appDb.prepare("SELECT * FROM logistics_companies WHERE id = ?").get(shipment.company_id) as { name?: string; pdf_code?: string } | undefined) : undefined;
  const ticketId = shipment.cw_ticket_id ?? Number(shipment.id);

  try {
    const pdf = await renderShipmentDocument(docTypeSlug(doc.doc_type), req.params.instance, doc.shipment_id, {
      companyName: company?.name ?? "",
      docRef: `${doc.shipment_id}${company?.pdf_code ? `-${company.pdf_code}` : ""}`,
    });
    const title = doc.pdf_filename.replace(/\.pdf$/i, "");
    const cwDocId = await getCwClient(req.params.instance).uploadTicketDocument(ticketId, pdf, doc.pdf_filename, title);
    db.prepare("UPDATE documents SET cw_document_id = ?, posted_at = datetime('now') WHERE id = ?").run(cwDocId, doc.id);
    res.json(db.prepare("SELECT * FROM documents WHERE id = ?").get(doc.id));
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Post to ConnectWise failed" });
  }
});

export default router;
