import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { Badge, Banner, Button, EmptyState, IconPackage, Select, Spinner, Tabs, useToast } from "../ui";
import type { TabDef } from "../ui";
import { useTabParam } from "../useTabParam";
import { useLogisticsInstance } from "../useLogisticsInstance";
import { LogisticsShipmentDocuments } from "./LogisticsShipmentDocuments";

interface ShipmentTicketDetail {
  id: number;
  ticketType: "service" | "project";
  summary: string;
  companyId: number | null;
  companyName: string;
  statusId: number | null;
  statusName: string;
  requiredDate: string | null;
  boardId: number | null;
  boardName: string | null;
  siteName: string | null;
  estimatedStartDate: string | null;
}

interface Shipment {
  id: string;
  company_id: number | null;
}

interface Company {
  id: number;
  is_default: number;
}

interface CwBoardStatus {
  id: number;
  name: string;
}

const tabs: TabDef[] = [
  { id: "packing", label: "Packing" },
  { id: "barcode", label: "Pack by Barcode" },
  { id: "documents", label: "Documents" },
];

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Shipment detail shell (INIT-0026 Phase 2) — the outer header + tab
 * structure only. Packing (Assembly workspace) is Phase 4, Documents is
 * Phase 3, Pack by Barcode is an unbuilt placeholder in LC itself (ported
 * as-is, not a gap CAST introduced). Mirrors `ShipmentPage.jsx`'s get-or-
 * create on load and its default-company auto-assignment.
 */
export function LogisticsShipment() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const [active, setActive] = useTabParam(
    tabs.map((t) => t.id),
    "packing",
  );

  // `?instance=` takes priority (an embed link needs to be self-contained —
  // see useLogisticsInstance) over whatever this browser last had stored.
  const [instance] = useLogisticsInstance("tritontech");
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [ticket, setTicket] = useState<ShipmentTicketDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [boardStatuses, setBoardStatuses] = useState<CwBoardStatus[] | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);

  const validId = !!id && /^\d+$/.test(id);

  useEffect(() => {
    if (!validId || !id) {
      setNotFound(true);
      return;
    }
    setNotFound(false);
    setShipment(null);
    api
      .get<Shipment>(`/logistics/${instance}/shipments/${id}`)
      // Not found -> create it (LC's own get-or-create-on-first-visit
      // behavior). If create itself 409s (a concurrent create already won —
      // e.g. two tabs opening the same ticket at once), fall back to a GET
      // rather than reporting "not found" for a shipment that now exists.
      .catch(() =>
        api
          .post<Shipment>(`/logistics/${instance}/shipments`, { id })
          .catch(() => api.get<Shipment>(`/logistics/${instance}/shipments/${id}`)),
      )
      .then(async (s) => {
        setShipment(s);
        if (s.company_id == null) {
          try {
            const companies = await api.get<Company[]>("/logistics/config/companies");
            const def = companies.find((c) => c.is_default);
            if (def) {
              const updated = await api.patch<Shipment>(`/logistics/${instance}/shipments/${id}`, { company_id: def.id });
              setShipment(updated);
            }
          } catch {
            /* non-critical — company can still be set later from the Documents tab */
          }
        }
      })
      .catch(() => setNotFound(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, instance, validId]);

  useEffect(() => {
    if (!validId || !id) return;
    api
      .get<ShipmentTicketDetail>(`/logistics/${instance}/cw/ticket/${id}`)
      .then(setTicket)
      .catch(() => setTicket(null));
  }, [id, instance, validId]);

  useEffect(() => {
    if (!ticket?.boardId) return;
    api
      .get<CwBoardStatus[]>(`/logistics/${instance}/cw/board/${ticket.boardId}/statuses`)
      .then(setBoardStatuses)
      .catch(() => setBoardStatuses(null));
  }, [ticket?.boardId, instance]);

  const changeStatus = async (statusId: number) => {
    if (!ticket || !id) return;
    setSavingStatus(true);
    try {
      await api.patch(`/logistics/${instance}/cw/ticket/${id}/status`, { ticketType: ticket.ticketType, statusId });
      const status = boardStatuses?.find((s) => s.id === statusId);
      if (status) setTicket((t) => (t ? { ...t, statusId: status.id, statusName: status.name } : t));
      toast("success", "Ticket status updated.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to update ticket status");
    } finally {
      setSavingStatus(false);
    }
  };

  if (notFound) {
    return (
      <EmptyState icon={<IconPackage />}>
        <div className="col gap-3">
          <span>Shipment not found.</span>
          <Button variant="secondary" onClick={() => navigate("/logistics/shipments")}>
            Return to Shipments
          </Button>
        </div>
      </EmptyState>
    );
  }

  if (!shipment) return <Spinner />;

  const dateBadge =
    ticket && (ticket.estimatedStartDate || ticket.requiredDate)
      ? [ticket.estimatedStartDate && `Ship By: ${formatDate(ticket.estimatedStartDate)}`, ticket.requiredDate && `Due By: ${formatDate(ticket.requiredDate)}`]
          .filter(Boolean)
          .join(" | ")
      : null;

  return (
    <div className="col gap-4">
      <div className="page-header">
        <div className="col gap-1">
          <div className="row gap-2 wrap">
            <Button variant="ghost" size="sm" onClick={() => navigate("/logistics/shipments")}>
              ← Back
            </Button>
            <h1 className="page-title">Shipment {shipment.id}</h1>
            {dateBadge && <Badge tone="info">{dateBadge}</Badge>}
          </div>
          {ticket && (
            <div className="page-subtitle">
              <strong>{ticket.companyName}</strong> · {ticket.summary}
              {ticket.siteName && ` · ${ticket.siteName}`}
            </div>
          )}
        </div>
        {ticket && (
          <div className="row gap-2">
            {boardStatuses && (
              <Select value={ticket.statusId ?? ""} disabled={savingStatus} onChange={(e) => changeStatus(Number(e.target.value))}>
                {boardStatuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
        )}
      </div>

      {!ticket && <Banner tone="warning">Could not load this ticket from ConnectWise — header details and status editing are unavailable.</Banner>}

      <Tabs tabs={tabs} active={active} onChange={setActive} />

      {active === "packing" ? (
        <EmptyState icon={<IconPackage />}>Packing (the Assembly workspace) is built in Phase 4.</EmptyState>
      ) : active === "barcode" ? (
        <EmptyState icon={<IconPackage />}>Barcode scanning will be available here.</EmptyState>
      ) : (
        id && <LogisticsShipmentDocuments instance={instance} shipmentId={id} ticket={ticket} />
      )}
    </div>
  );
}
