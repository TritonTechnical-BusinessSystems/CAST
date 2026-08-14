import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useSortFilter } from "../useSortFilter";
import { PageHeader, Card, CardBody, Table, SortableHeaderCell, Field, Select, Badge, Banner, Spinner, Button, EmptyState, IconPackage } from "../ui";

interface CwInstance {
  id: string;
  name: string;
  isDefault: boolean;
}

interface ShippingRequestTicket {
  id: number;
  ticketType: "service" | "project";
  summary: string;
  companyId: number | null;
  companyName: string;
  statusId: number | null;
  statusName: string;
  requiredDate: string | null;
}

const INSTANCE_STORAGE_KEY = "cast.logistics.instance";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Outbound Shipment list (INIT-0026 Phase 2). Mirrors LC's `TicketsPage.jsx`
 * exactly: this IS a live ConnectWise ticket query (Service + Project
 * tickets matching the "Shipping Request" filter), not a local table — the
 * local `shipments` row only exists once a ticket's detail page has been
 * opened (see LogisticsShipment.tsx's get-or-create). No "New Shipment"
 * button by design — LC has none either; you arrive at a shipment by
 * clicking an existing open Shipping Request ticket.
 */
export function LogisticsShipments() {
  const navigate = useNavigate();
  const [instances, setInstances] = useState<CwInstance[] | null>(null);
  const [instance, setInstance] = useState<string>(() => localStorage.getItem(INSTANCE_STORAGE_KEY) ?? "");
  const [tickets, setTickets] = useState<ShippingRequestTicket[] | null>(null);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [countsLoading, setCountsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get<CwInstance[]>("/logistics/instances").then((rows) => {
      setInstances(rows);
      if (!instance) {
        const def = rows.find((r) => r.isDefault) ?? rows[0];
        if (def) setInstance(def.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!instance) return;
    localStorage.setItem(INSTANCE_STORAGE_KEY, instance);
    setLoading(true);
    setError(null);
    setTickets(null);
    setCounts({});
    api
      .get<ShippingRequestTicket[]>(`/logistics/${instance}/cw/shipping-requests`)
      .then((rows) => {
        setTickets(rows);
        if (rows.length > 0) {
          setCountsLoading(true);
          const ids = rows.map((r) => r.id).join(",");
          api
            .get<Record<string, number>>(`/logistics/${instance}/cw/shipping-requests/product-counts?ids=${ids}`)
            .then((c) => setCounts(Object.fromEntries(Object.entries(c).map(([k, v]) => [Number(k), v]))))
            .catch(() => {})
            .finally(() => setCountsLoading(false));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load tickets from ConnectWise"))
      .finally(() => setLoading(false));
  }, [instance]);

  const { sort, toggleSort, filters, setFilter, clearFilters, activeFilterCount, filtered } = useSortFilter<ShippingRequestTicket>(
    tickets ?? [],
    {
      id: (t) => String(t.id),
      company: (t) => t.companyName,
      summary: (t) => t.summary,
      status: (t) => t.statusName,
      due: (t) => t.requiredDate ?? "",
    },
    { key: "id", dir: "desc" },
  );

  if (!instances) return <Spinner />;

  return (
    <div className="col gap-4">
      <PageHeader
        title="Outbound Shipments"
        subtitle="Live ConnectWise Shipping Request tickets — click a row to open its packing/documents workspace."
        actions={
          <Field label="CW Instance">
            <Select value={instance} onChange={(e) => setInstance(e.target.value)}>
              {instances.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>
        }
      />

      {error && <Banner tone="danger">Could not load tickets from ConnectWise: {error}</Banner>}

      {loading && !tickets && (
        <Card>
          <CardBody>
            <div className="row gap-2">
              <Spinner /> <span className="muted">Loading tickets from ConnectWise…</span>
            </div>
          </CardBody>
        </Card>
      )}

      {tickets && (
        <Card>
          <CardBody>
            <div className="col gap-3">
              {activeFilterCount > 0 && (
                <div>
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    Clear {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}
                  </Button>
                </div>
              )}

              {filtered.length === 0 ? (
                <EmptyState icon={<IconPackage />}>
                  {activeFilterCount > 0 ? "No tickets match the current filters." : "No open Shipping Requests found."}
                </EmptyState>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <SortableHeaderCell label="Ticket #" sortKey="id" sort={sort} onSort={toggleSort} filterValue={filters.id} onFilterChange={(v) => setFilter("id", v)} />
                      <SortableHeaderCell label="Company" sortKey="company" sort={sort} onSort={toggleSort} filterValue={filters.company} onFilterChange={(v) => setFilter("company", v)} />
                      <SortableHeaderCell label="Summary" sortKey="summary" sort={sort} onSort={toggleSort} filterValue={filters.summary} onFilterChange={(v) => setFilter("summary", v)} />
                      <SortableHeaderCell label="Status" sortKey="status" sort={sort} onSort={toggleSort} filterValue={filters.status} onFilterChange={(v) => setFilter("status", v)} />
                      <SortableHeaderCell label="Due Date" sortKey="due" sort={sort} onSort={toggleSort} />
                      <th>Items</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t) => (
                      <tr key={`${t.ticketType}-${t.id}`} className="row-clickable" onClick={() => navigate(`/logistics/shipment/${t.id}`)}>
                        <td>{t.id}</td>
                        <td>{t.companyName || <span className="hint">—</span>}</td>
                        <td>{t.summary}</td>
                        <td>
                          <Badge tone="neutral">{t.statusName || "—"}</Badge>
                        </td>
                        <td>{formatDate(t.requiredDate)}</td>
                        <td>{counts[t.id] ?? (countsLoading ? <Spinner /> : "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}

              <div className="hint">
                {filtered.length} of {tickets.length} ticket{tickets.length === 1 ? "" : "s"}
                {countsLoading && " · Updating item counts…"}
              </div>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
