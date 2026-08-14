import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader, Card, CardHeader, CardBody, Field, Select, Badge, Banner, Spinner, Button, Table, useToast } from "../ui";

interface CwInstance {
  id: string;
  name: string;
  isDefault: boolean;
}

interface EmbeddablePage {
  label: string;
  route: string;
  built: boolean;
  note?: string;
}

const INSTANCE_STORAGE_KEY = "cast.logistics.instance";

/**
 * Every Logistics view a CW Custom Menu Entry Link can point at. Update this
 * list's `built` flag as each rebuild phase lands a real route — this page
 * is the source of truth for what's embeddable today, not aspirational.
 */
const EMBEDDABLE_PAGES: EmbeddablePage[] = [
  { label: "Outbound Shipments", route: "/logistics/shipments", built: true },
  { label: "Shipment Detail", route: "/logistics/shipment/:id", built: true, note: "Documents built; Packing is Phase 4" },
  { label: "Receiving", route: "/logistics/receiving", built: false, note: "Phase 5" },
  { label: "PO Drilldown", route: "/logistics/receiving/:poId", built: false, note: "Phase 6" },
  { label: "Configuration", route: "/logistics/config", built: true },
];

/**
 * Logistics landing page (INIT-0026's native rebuild of LogisticsCoordinator).
 *
 * Reframed 2026-08-14: day-to-day access to Logistics is via embedding these
 * pages inside ConnectWise (Custom Menu Entry Links), not direct navigation
 * — so this page's job is generating/copying those embed links, not being a
 * dashboard itself. Direct links to the underlying pages exist for dev/test
 * only, listed here alongside their embed counterparts.
 *
 * Embed-link generation depends on Phase 8's URL-secret-key auth mechanism,
 * not yet built — until then, "Copy embed link" is disabled per page.
 */
export function Logistics() {
  const toast = useToast();
  const [instances, setInstances] = useState<CwInstance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(() => localStorage.getItem(INSTANCE_STORAGE_KEY) ?? "");

  useEffect(() => {
    api
      .get<CwInstance[]>("/logistics/instances")
      .then((rows) => {
        setInstances(rows);
        if (!selected) {
          const def = rows.find((r) => r.isDefault) ?? rows[0];
          if (def) {
            setSelected(def.id);
            localStorage.setItem(INSTANCE_STORAGE_KEY, def.id);
          }
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load CW instances"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSelect = (id: string) => {
    setSelected(id);
    localStorage.setItem(INSTANCE_STORAGE_KEY, id);
  };

  return (
    <div className="col gap-4">
      <PageHeader
        title="Logistics"
        subtitle="Embedded inside ConnectWise via Custom Menu Entry Links — this page generates those links. Direct access below is for development/testing only."
      />

      {error && <Banner tone="danger">{error}</Banner>}

      {!instances && !error && (
        <Card>
          <CardBody>
            <Spinner /> Loading…
          </CardBody>
        </Card>
      )}

      {instances && (
        <Card>
          <CardHeader
            title="Embed links"
            action={
              <Field label="Generate links for">
                <Select value={selected} onChange={(e) => onSelect(e.target.value)}>
                  {instances.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              </Field>
            }
          />
          <CardBody>
            <Table>
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Status</th>
                  <th>Direct link (dev/test)</th>
                  <th>Embed link</th>
                </tr>
              </thead>
              <tbody>
                {EMBEDDABLE_PAGES.map((p) => (
                  <tr key={p.route}>
                    <td>{p.label}</td>
                    <td>
                      {p.built ? (
                        <Badge tone="success">Built</Badge>
                      ) : (
                        <Badge tone="neutral">Not built yet{p.note ? ` — ${p.note}` : ""}</Badge>
                      )}
                    </td>
                    <td>{p.built ? <a href={p.route}>{p.route}</a> : <span className="hint">{p.route}</span>}</td>
                    <td>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!p.built}
                        onClick={() => {
                          navigator.clipboard.writeText(`${location.origin}${p.route}?embed=1`);
                          toast("success", `Copied embed link for ${p.label}`);
                        }}
                      >
                        Copy embed link
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
