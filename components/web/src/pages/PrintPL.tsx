import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { PackingList } from "../documents/PackingList";
import type { PackingListData, CwTicketDetail } from "../documents/types";

declare global {
  interface Window {
    PRINT_READY?: boolean;
  }
}

/** `/print/pl/:id?instance=...` — see PrintCI.tsx for the shared design notes. */
export function PrintPL() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const instance = params.get("instance") ?? "";
  const [data, setData] = useState<PackingListData | null>(null);
  const [ticket, setTicket] = useState<CwTicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !instance) {
      setError("Missing shipment id or CW instance");
      return;
    }
    Promise.all([
      fetch(`/api/logistics/${instance}/documents/${id}/packing-list-data`, { credentials: "same-origin" }).then((r) => {
        if (!r.ok) throw new Error(`packing-list-data ${r.status}`);
        return r.json() as Promise<PackingListData>;
      }),
      fetch(`/api/logistics/${instance}/cw/ticket/${id}`, { credentials: "same-origin" })
        .then((r) => (r.ok ? (r.json() as Promise<CwTicketDetail>) : null))
        .catch(() => null),
    ])
      .then(([plData, ticketData]) => {
        setData(plData);
        setTicket(ticketData);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load packing list data"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, instance]);

  useEffect(() => {
    if (data !== null || error !== null) window.PRINT_READY = true;
  }, [data, error]);

  if (error) return <div className="doc-error">Print Error: {error}</div>;
  if (!data) return null;

  const noop = () => {};
  return <PackingList data={data} shipment={data.shipment} ticket={ticket} companies={[]} carriers={[]} incoterms={[]} onSaveShipment={noop} printMode />;
}
