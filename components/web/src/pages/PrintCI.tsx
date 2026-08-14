import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { CommercialInvoice } from "../documents/CommercialInvoice";
import type { InvoiceData, CwTicketDetail } from "../documents/types";

// Set as soon as this module runs so a TypeScript build never needs DOM lib
// changes elsewhere — Playwright polls `window.PRINT_READY` (pdf/render.ts).
declare global {
  interface Window {
    PRINT_READY?: boolean;
  }
}

/**
 * `/print/ci/:id?instance=...` — reached ONLY by the backend's own
 * Playwright render (`pdf/render.ts`), which injects a short-lived internal
 * session cookie before navigating here (this route sits outside the app's
 * normal `RequireAuth` shell so it renders bare, with no sidebar/header).
 * Renders the exact same `CommercialInvoice` the interactive Documents tab
 * uses, with `printMode` — mirrors LC's `PrintCIPage.jsx` exactly, right
 * down to firing PRINT_READY on error too so a bad shipment id can never
 * hang the PDF render.
 */
export function PrintCI() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const instance = params.get("instance") ?? "";
  const [data, setData] = useState<InvoiceData | null>(null);
  const [ticket, setTicket] = useState<CwTicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !instance) {
      setError("Missing shipment id or CW instance");
      return;
    }
    Promise.all([
      fetch(`/api/logistics/${instance}/documents/${id}/invoice-data`, { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`invoice-data ${r.status}`);
        return r.json() as Promise<InvoiceData>;
      }),
      fetch(`/api/logistics/${instance}/cw/ticket/${id}`, { credentials: "same-origin" })
        .then((r) => (r.ok ? (r.json() as Promise<CwTicketDetail>) : null))
        .catch(() => null),
    ])
      .then(([invoiceData, ticketData]) => {
        setData(invoiceData);
        setTicket(ticketData);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load invoice data"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, instance]);

  useEffect(() => {
    if (data !== null || error !== null) window.PRINT_READY = true;
  }, [data, error]);

  if (error) return <div className="doc-error">Print Error: {error}</div>;
  if (!data) return null;

  const noop = () => {};
  return (
    <CommercialInvoice
      data={data}
      shipment={data.shipment}
      ticket={ticket}
      companies={[]}
      carriers={[]}
      currencies={[]}
      presets={[]}
      onSaveShipment={noop}
      onPatchLineItem={noop}
      printMode
    />
  );
}
