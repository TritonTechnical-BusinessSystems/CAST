import { Fragment } from "react";
import "./documents.css";
import { EditField, SelectField, DocCard, PrintModeProvider } from "./DocumentFields";
import { UM_ABBR } from "./types";
import type { PackingListData, Shipment, Company, CwTicketDetail, PlItem } from "./types";

const INCOTERMS = ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF"];

function addressBlock(c: Company): string {
  if (c.address_block) return c.address_block;
  return [c.address_line1, c.address_line2, [c.city, c.state, c.zip].filter(Boolean).join(", "), c.country].filter(Boolean).join("\n");
}

function ItemRows({ items }: { items: PlItem[] }) {
  return (
    <>
      {items.map((item) => (
        <tr key={item.cw_product_id}>
          <td className="doc-num">{item.total_qty}</td>
          <td>{UM_ABBR[item.unit_of_measure ?? ""] ?? item.unit_of_measure ?? ""}</td>
          <td>
            {item.description_override ?? item.description ?? ""}
            {item.manufacturer && <span className="doc-serials"> — {item.manufacturer}</span>}
            {item.serial_numbers.length > 0 && <div className="doc-serials">S/N: {item.serial_numbers.join(", ")}</div>}
          </td>
          <td>{item.part_number ?? ""}</td>
          <td>{item.source_ticket_id ?? ""}</td>
        </tr>
      ))}
    </>
  );
}

export function PackingList({
  data,
  shipment,
  ticket,
  companies,
  carriers,
  onSaveShipment,
  printMode = false,
  zoom = 1,
}: {
  data: PackingListData;
  shipment: Shipment;
  ticket: CwTicketDetail | null;
  companies: Company[];
  carriers: string[];
  onSaveShipment: (patch: Partial<Shipment>) => void;
  printMode?: boolean;
  zoom?: number;
}) {
  const company = data.company;
  const docRef = `${shipment.id}${company?.pdf_code ? `-${company.pdf_code}` : ""}-PL`;

  const totalQty =
    data.pallets.reduce((s, p) => s + p.items.reduce((s2, i) => s2 + i.total_qty, 0) + p.boxes.reduce((s2, b) => s2 + b.items.reduce((s3, i) => s3 + i.total_qty, 0), 0), 0) +
    data.standalone_boxes.reduce((s, b) => s + b.items.reduce((s2, i) => s2 + i.total_qty, 0), 0);

  const hasAnyItems = data.pallets.length > 0 || data.standalone_boxes.length > 0;

  return (
    <PrintModeProvider value={printMode}>
      <div className="doc-page" style={zoom !== 1 ? { transform: `scale(${zoom})` } : undefined}>
        <div className="doc-header">
          {company?.logo_filename ? <img className="doc-logo" src={`/api/logistics/config/companies/${company.id}/logo`} alt={company.name} /> : <div />}
          <div className="doc-title-block">
            <div className="doc-title">PACKING LIST</div>
            <div className="doc-ref">{docRef}</div>
            <div className="doc-ref">
              PL Date: <EditField value={shipment.ci_date ?? ""} onSave={(v) => onSaveShipment({ ci_date: v })} placeholder="MM/DD/YYYY" />
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
                  <td>Carrier</td>
                  <td>
                    <SelectField value={shipment.carrier ?? ""} options={carriers} onSave={(v) => onSaveShipment({ carrier: v })} />
                  </td>
                </tr>
                <tr>
                  <td>Weight</td>
                  <td>
                    <EditField value={shipment.weight != null ? String(shipment.weight) : ""} onSave={(v) => onSaveShipment({ weight: v ? Number(v) : null })} />
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
                  <td>Total Qty</td>
                  <td>
                    <span className="doc-value">{totalQty}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </DocCard>
        </div>

        <table className="doc-table">
          <thead>
            <tr>
              <th>Qty</th>
              <th>U/M</th>
              <th>Description of Goods</th>
              <th>Part #</th>
              <th>SR#</th>
            </tr>
          </thead>
          <tbody>
            {!hasAnyItems ? (
              <tr>
                <td colSpan={5} className="doc-empty-cell">
                  No items packed yet.
                </td>
              </tr>
            ) : (
              <>
                {data.pallets.map((pallet) => (
                  <Fragment key={`pallet-${pallet.id}`}>
                    <tr className="doc-group-header">
                      <td colSpan={5}>Pallet {pallet.number}</td>
                    </tr>
                    <ItemRows items={pallet.items} />
                    {pallet.boxes.map((box) => (
                      <Fragment key={`box-${box.id}`}>
                        <tr className="doc-group-header doc-group-sub">
                          <td colSpan={5}>↳ Box {box.number}</td>
                        </tr>
                        <ItemRows items={box.items} />
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
                {data.standalone_boxes.map((box) => (
                  <Fragment key={`sbox-${box.id}`}>
                    <tr className="doc-group-header">
                      <td colSpan={5}>Box {box.number}</td>
                    </tr>
                    <ItemRows items={box.items} />
                  </Fragment>
                ))}
              </>
            )}
          </tbody>
          {hasAnyItems && (
            <tfoot>
              <tr>
                <td colSpan={5}>
                  <strong>Total Pieces:</strong> {data.pieces} &nbsp;&nbsp; <strong>Total Qty:</strong> {totalQty}
                </td>
              </tr>
            </tfoot>
          )}
        </table>

        <div className="doc-signature">Authorized Signature &amp; Date</div>
      </div>
    </PrintModeProvider>
  );
}
