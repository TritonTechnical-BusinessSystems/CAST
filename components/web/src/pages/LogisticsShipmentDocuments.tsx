import { useEffect, useState } from "react";
import { api } from "../api";
import { Button, Select, Banner, Spinner, useToast } from "../ui";
import { CommercialInvoice } from "../documents/CommercialInvoice";
import { PackingList } from "../documents/PackingList";
import type { InvoiceData, PackingListData, Shipment, CiLineItem, CwTicketDetail, Company } from "../documents/types";

interface Currency {
  code: string;
}
interface CiFlagOpt {
  id: number;
  name: string;
}
interface Preset {
  id: number;
  name: string;
  content: string;
}
interface DocumentLedgerRow {
  id: number;
  doc_type: "packing_list" | "commercial_invoice";
  posted_at: string | null;
}

const ZOOM_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5];

export function LogisticsShipmentDocuments({ instance, shipmentId, ticket }: { instance: string; shipmentId: string; ticket: CwTicketDetail | null }) {
  const toast = useToast();
  const [docType, setDocType] = useState<"commercial_invoice" | "packing_list">("commercial_invoice");
  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null);
  const [plData, setPlData] = useState<PackingListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [carriers, setCarriers] = useState<string[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [incoterms, setIncoterms] = useState<string[]>([]);
  const [ciFlags, setCiFlags] = useState<CiFlagOpt[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [ledger, setLedger] = useState<DocumentLedgerRow[]>([]);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Company[]>("/logistics/config/companies").then(setCompanies).catch(() => {});
    api.get<string[]>(`/logistics/${instance}/config/carriers`).then(setCarriers).catch(() => {});
    api.get<Currency[]>(`/logistics/${instance}/config/currencies`).then(setCurrencies).catch(() => {});
    api.get<string[]>("/logistics/config/incoterms").then(setIncoterms).catch(() => {});
    api.get<CiFlagOpt[]>("/logistics/config/ci-flags").then(setCiFlags).catch(() => {});
    api.get<Preset[]>("/logistics/config/export-presets").then(setPresets).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadLedger = () => api.get<DocumentLedgerRow[]>(`/logistics/${instance}/documents/${shipmentId}`).then(setLedger).catch(() => {});

  const loadInvoiceData = () =>
    api
      .get<InvoiceData>(`/logistics/${instance}/documents/${shipmentId}/invoice-data`)
      .then(setInvoiceData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load invoice data"));

  const loadPlData = () =>
    api
      .get<PackingListData>(`/logistics/${instance}/documents/${shipmentId}/packing-list-data`)
      .then(setPlData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load packing list data"));

  useEffect(() => {
    setError(null);
    loadLedger();
    if (docType === "commercial_invoice" && !invoiceData) loadInvoiceData();
    if (docType === "packing_list" && !plData) loadPlData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docType]);

  const refresh = () => {
    setError(null);
    if (docType === "commercial_invoice") loadInvoiceData();
    else loadPlData();
  };

  const patchShipment = async (patch: Partial<Shipment>) => {
    try {
      const updated = await api.patch<Shipment>(`/logistics/${instance}/shipments/${shipmentId}`, patch);
      setInvoiceData((d) => (d ? { ...d, shipment: updated } : d));
      setPlData((d) => (d ? { ...d, shipment: updated } : d));
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to save");
    }
  };

  const patchLineItem = async (cwProductId: number, patch: Partial<CiLineItem>) => {
    try {
      await api.patch(`/logistics/${instance}/documents/${shipmentId}/line-item/${cwProductId}`, patch);
      loadInvoiceData();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to save line item");
    }
  };

  const resetOverrides = async () => {
    if (!confirm("Reset all Commercial Invoice overrides and shipment fields? This cannot be undone.")) return;
    try {
      await api.post(`/logistics/${instance}/documents/${shipmentId}/reset-ci-overrides`);
      loadInvoiceData();
      toast("success", "Reset complete.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Reset failed");
    }
  };

  const setCiFlag = async (ciFlagId: number | null) => {
    await patchShipment({ ci_flag_id: ciFlagId });
    loadInvoiceData();
  };

  const exportPdf = async () => {
    setBusy(true);
    try {
      const slug = docType === "commercial_invoice" ? "commercial-invoice" : "packing-list";
      const doc = await api.post<{ id: number }>(`/logistics/${instance}/documents/${shipmentId}/${slug}/generate`);
      const a = document.createElement("a");
      a.href = `/api/logistics/${instance}/documents/download/${doc.id}`;
      a.download = "";
      a.click();
      loadLedger();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "PDF generation failed");
    } finally {
      setBusy(false);
    }
  };

  const postToCw = async () => {
    setBusy(true);
    try {
      const slug = docType === "commercial_invoice" ? "commercial-invoice" : "packing-list";
      const doc = await api.post<{ id: number }>(`/logistics/${instance}/documents/${shipmentId}/${slug}/generate`);
      await api.post(`/logistics/${instance}/documents/${doc.id}/post-to-cw`);
      toast("success", "Posted to ConnectWise.");
      loadLedger();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Post to ConnectWise failed");
    } finally {
      setBusy(false);
    }
  };

  const lastPosted = ledger.filter((d) => d.doc_type === docType && d.posted_at).sort((a, b) => (a.posted_at! < b.posted_at! ? 1 : -1))[0];

  return (
    <div className="col gap-3">
      <div className="row gap-3 wrap">
        <Select value={docType} onChange={(e) => setDocType(e.target.value as typeof docType)}>
          <option value="commercial_invoice">Commercial Invoice</option>
          <option value="packing_list">Packing List</option>
        </Select>
        <Button variant="ghost" size="sm" onClick={refresh}>
          Refresh
        </Button>
        {docType === "commercial_invoice" && (
          <>
            <Button variant="ghost" size="sm" onClick={resetOverrides}>
              Reset
            </Button>
            {ciFlags.length > 0 && (
              <Select value={invoiceData?.shipment.ci_flag_id ?? ""} onChange={(e) => setCiFlag(e.target.value ? Number(e.target.value) : null)}>
                <option value="">No CI flag</option>
                {ciFlags.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            )}
          </>
        )}
        <Select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
          {ZOOM_OPTIONS.map((z) => (
            <option key={z} value={z}>
              {Math.round(z * 100)}%
            </option>
          ))}
        </Select>
        <div className="row gap-2 grow end">
          {lastPosted && <span className="hint">Last posted to CW {new Date(lastPosted.posted_at!).toLocaleString()}</span>}
          <Button variant="secondary" size="sm" onClick={exportPdf} disabled={busy}>
            Export PDF
          </Button>
          <Button variant="primary" size="sm" onClick={postToCw} disabled={busy}>
            Post to CW
          </Button>
        </div>
      </div>

      {error && <Banner tone="danger">{error}</Banner>}

      {docType === "commercial_invoice" ? (
        !invoiceData ? (
          <Spinner />
        ) : (
          <CommercialInvoice
            data={invoiceData}
            shipment={invoiceData.shipment}
            ticket={ticket}
            companies={companies}
            carriers={carriers}
            currencies={currencies.map((c) => c.code)}
            incoterms={incoterms}
            presets={presets}
            onSaveShipment={patchShipment}
            onPatchLineItem={patchLineItem}
            zoom={zoom}
          />
        )
      ) : !plData ? (
        <Spinner />
      ) : (
        <PackingList
          data={plData}
          shipment={plData.shipment}
          ticket={ticket}
          companies={companies}
          carriers={carriers}
          incoterms={incoterms}
          onSaveShipment={patchShipment}
          zoom={zoom}
        />
      )}
    </div>
  );
}
