import "./documents.css";
import { EditField, SelectField, DocCard, PrintModeProvider } from "./DocumentFields";
import { UM_ABBR } from "./types";
import type { InvoiceData, Shipment, Company, CwTicketDetail, CiLineItem } from "./types";

const INCOTERMS = ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF"];

/** manual→manual_price, catalog_msrp→msrp, catalog_price→catalog_price, avg_sold→avg_unit_price, else (max_sold/default)→max_unit_price ?? unit_price. */
function getEffectivePrice(item: CiLineItem): number | null {
  switch (item.price_source) {
    case "manual":
      return item.manual_price;
    case "catalog_msrp":
      return item.msrp;
    case "catalog_price":
      return item.catalog_price;
    case "avg_sold":
      return item.avg_unit_price;
    default:
      return item.max_unit_price ?? item.unit_price;
  }
}

function addressBlock(c: Company): string {
  if (c.address_block) return c.address_block;
  return [c.address_line1, c.address_line2, [c.city, c.state, c.zip].filter(Boolean).join(", "), c.country].filter(Boolean).join("\n");
}

function taxLine(label: string, field: "ein" | "vat" | "eori" | "" | null, ein: string | null, vat: string | null, eori: string | null): string | null {
  if (field === "ein" && ein) return `EIN: ${ein}`;
  if (field === "vat" && vat) return `VAT: ${vat}`;
  if (field === "eori" && eori) return `EORI: ${eori}`;
  return null;
}

export function CommercialInvoice({
  data,
  shipment,
  ticket,
  companies,
  carriers,
  currencies,
  presets,
  onSaveShipment,
  onPatchLineItem,
  printMode = false,
  zoom = 1,
}: {
  data: InvoiceData;
  shipment: Shipment;
  ticket: CwTicketDetail | null;
  companies: Company[];
  carriers: string[];
  currencies: string[];
  presets: { id: number; name: string; content: string }[];
  onSaveShipment: (patch: Partial<Shipment>) => void;
  onPatchLineItem: (cwProductId: number, patch: Partial<CiLineItem>) => void;
  printMode?: boolean;
  zoom?: number;
}) {
  const company = data.company;
  const docRef = `${shipment.id}${company?.pdf_code ? `-${company.pdf_code}` : ""}-CI`;
  const grandTotal = data.line_items.reduce((sum, item) => {
    const price = getEffectivePrice(item);
    return sum + (price != null ? Math.round(price * 100) / 100 : 0) * item.total_qty;
  }, 0);

  const shipperTax = company ? taxLine("", shipment.shipper_tax_field, company.ein, company.vat, company.eori) : null;
  const consigneeTax = taxLine("", shipment.consignee_tax_field, shipment.consignee_ein, shipment.consignee_vat, shipment.consignee_eori);

  return (
    <PrintModeProvider value={printMode}>
      <div className="doc-page" style={zoom !== 1 ? { transform: `scale(${zoom})` } : undefined}>
        <div className="doc-header">
          {company?.logo_filename ? <img className="doc-logo" src={`/api/logistics/config/companies/${company.id}/logo`} alt={company.name} /> : <div />}
          <div className="doc-title-block">
            <div className="doc-title">COMMERCIAL INVOICE</div>
            <div className="doc-ref">{docRef}</div>
            <div className="doc-ref">
              Date:{" "}
              <EditField value={shipment.ci_date ?? ""} onSave={(v) => onSaveShipment({ ci_date: v })} placeholder="MM/DD/YYYY" />
            </div>
          </div>
        </div>

        <div className="doc-grid">
          <DocCard
            title="Shipper"
            action={
              !printMode && (
                <select
                  className="doc-input"
                  value={shipment.company_id ?? ""}
                  onChange={(e) => onSaveShipment({ company_id: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">Select…</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )
            }
          >
            {company ? (
              <>
                <div>
                  <strong>{company.name}</strong>
                </div>
                <div className="doc-address-block">{addressBlock(company)}</div>
                {company.phone && <div>{company.phone}</div>}
                {company.email && <div>{company.email}</div>}
                {shipperTax && <div>{shipperTax}</div>}
              </>
            ) : (
              <span className="doc-value">No shipper selected</span>
            )}
          </DocCard>

          <DocCard title="Consignee">
            {ticket ? (
              <>
                <div>
                  <strong>{ticket.companyName}</strong>
                </div>
                <div>{ticket.siteName ?? ""}</div>
              </>
            ) : (
              <span className="doc-value">Unavailable</span>
            )}
          </DocCard>

          <DocCard
            title="Ship To"
            action={
              !printMode && (
                <label className="doc-checkbox-label">
                  <input
                    type="checkbox"
                    checked={!!shipment.ship_to_same_as_consignee}
                    onChange={(e) => onSaveShipment({ ship_to_same_as_consignee: e.target.checked ? 1 : 0 })}
                  />{" "}
                  Same as Consignee
                </label>
              )
            }
          >
            {shipment.ship_to_same_as_consignee ? (
              <span className="doc-value">Same as Consignee</span>
            ) : (
              <>
                <EditField value={shipment.consignee_name ?? ""} onSave={(v) => onSaveShipment({ consignee_name: v })} placeholder="Name" />
                <EditField value={shipment.consignee_address ?? ""} onSave={(v) => onSaveShipment({ consignee_address: v })} placeholder="Address" multiline />
                {consigneeTax && <div>{consigneeTax}</div>}
              </>
            )}
          </DocCard>

          <DocCard title="Details">
            <table style={{ width: "100%" }}>
              <tbody>
                <tr>
                  <td>Incoterm</td>
                  <td>
                    <SelectField value={shipment.incoterm ?? ""} options={INCOTERMS} onSave={(v) => onSaveShipment({ incoterm: v })} />
                  </td>
                  <td>Currency</td>
                  <td>
                    <SelectField value={shipment.currency} options={currencies} onSave={(v) => onSaveShipment({ currency: v })} />
                  </td>
                </tr>
                <tr>
                  <td>Carrier</td>
                  <td>
                    <SelectField value={shipment.carrier ?? ""} options={carriers} onSave={(v) => onSaveShipment({ carrier: v })} />
                  </td>
                  <td>AWB #</td>
                  <td>
                    <EditField value={shipment.awb_number ?? ""} onSave={(v) => onSaveShipment({ awb_number: v })} />
                  </td>
                </tr>
                <tr>
                  <td>Pieces</td>
                  <td>
                    <span className="doc-value">{data.pieces}</span>
                  </td>
                  <td>Weight</td>
                  <td>
                    <EditField value={shipment.weight != null ? String(shipment.weight) : ""} onSave={(v) => onSaveShipment({ weight: v ? Number(v) : null })} />
                  </td>
                </tr>
              </tbody>
            </table>
          </DocCard>
        </div>

        {data.ci_flag && (
          <div className="doc-flag-banner" style={{ borderColor: data.ci_flag.color, color: data.ci_flag.color, fontSize: `${data.ci_flag.font_size}px` }}>
            {data.ci_flag.content}
          </div>
        )}

        <table className="doc-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Qty</th>
              <th>U/M</th>
              <th>Description of Goods</th>
              <th>HS Code</th>
              <th>Origin</th>
              <th>SR#</th>
              <th className="doc-num">Unit Value</th>
              <th className="doc-num">Total Value</th>
              <th>{data.has_pallets ? "Pallet | Box" : "Box"}</th>
            </tr>
          </thead>
          <tbody>
            {data.line_items.length === 0 ? (
              <tr>
                <td colSpan={10} className="doc-empty-cell">
                  No items packed yet.
                </td>
              </tr>
            ) : (
              data.line_items.map((item, i) => {
                const effHs = item.hs_code_override ?? item.hs_code ?? "";
                const effOrigin = item.country_of_origin_override ?? item.country_of_origin ?? "";
                const effDesc = item.description_override ?? item.description ?? "";
                const price = getEffectivePrice(item);
                const rounded = price != null ? Math.round(price * 100) / 100 : null;
                const total = rounded != null ? rounded * item.total_qty : 0;
                const isModified = !!(item.description_override || item.hs_code_override || item.country_of_origin_override || item.price_source === "manual");
                return (
                  <tr key={item.cw_product_id}>
                    <td>{i + 1}</td>
                    <td className="doc-num">{item.total_qty}</td>
                    <td>{UM_ABBR[item.unit_of_measure ?? ""] ?? item.unit_of_measure ?? ""}</td>
                    <td className={isModified ? "doc-modified" : undefined}>
                      <EditField value={effDesc} onSave={(v) => onPatchLineItem(item.cw_product_id, { description_override: v })} multiline />
                      {item.serial_numbers.length > 0 && <div className="doc-serials">S/N: {item.serial_numbers.join(", ")}</div>}
                    </td>
                    <td>
                      <EditField value={effHs} onSave={(v) => onPatchLineItem(item.cw_product_id, { hs_code_override: v })} />
                    </td>
                    <td>
                      <EditField value={effOrigin} onSave={(v) => onPatchLineItem(item.cw_product_id, { country_of_origin_override: v })} />
                    </td>
                    <td>{item.source_ticket_id ?? ""}</td>
                    <td className="doc-num">
                      <EditField
                        value={rounded != null ? rounded.toFixed(2) : ""}
                        onSave={(v) => onPatchLineItem(item.cw_product_id, v ? { price_source: "manual", manual_price: Number(v) } : { price_source: null, manual_price: null })}
                      />
                    </td>
                    <td className="doc-num">{total.toFixed(2)}</td>
                    <td>{item.box_assignments.map((b) => `${b.label} (${b.qty})`).join("\n") || "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        <div className="doc-footer-row">
          <div className="doc-export-statement">
            <DocCard
              title="Export Statement"
              action={
                !printMode &&
                presets.length > 0 && (
                  <select
                    className="doc-input"
                    value=""
                    onChange={(e) => {
                      const preset = presets.find((p) => p.id === Number(e.target.value));
                      if (preset) onSaveShipment({ export_statement: preset.content });
                    }}
                  >
                    <option value="">Use preset…</option>
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )
              }
            >
              <EditField
                value={shipment.export_statement ?? data.effective_export_statement}
                onSave={(v) => onSaveShipment({ export_statement: v })}
                multiline
              />
            </DocCard>
          </div>
          <div className="doc-total">
            Commercial Invoice Total
            <br />
            {shipment.currency} {grandTotal.toFixed(2)}
          </div>
        </div>

        <div className="doc-signature">Authorized Signature &amp; Date</div>
      </div>
    </PrintModeProvider>
  );
}

