import { useEffect, useState } from "react";
import { api } from "../api";
import { useLogisticsInstance } from "../useLogisticsInstance";
import { Card, CardHeader, CardBody, Field, Select, Badge, Banner, Spinner, Button, Table, useToast } from "../ui";

interface CwInstance {
  id: string;
  name: string;
}

interface EmbeddablePage {
  label: string;
  route: string;
  built: boolean;
  note?: string;
}

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
  { label: "Configuration", route: "/logistics", built: true },
];

/**
 * Embed-link generation (INIT-0026's native rebuild of LogisticsCoordinator).
 * Reframed 2026-08-14: day-to-day access to Logistics is via embedding these
 * pages inside ConnectWise (Custom Menu Entry Links), not direct navigation
 * — so this tab's job is generating/copying those embed links. Direct links
 * to the underlying pages exist for dev/test only, listed here alongside
 * their embed counterparts.
 *
 * Embed-link generation depends on Phase 8's URL-secret-key auth mechanism,
 * not yet built — until then, "Copy embed link" is disabled per page.
 */
export function LogisticsConfigEmbedLinks() {
  const toast = useToast();
  const [instances, setInstances] = useState<CwInstance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, onSelect] = useLogisticsInstance();

  useEffect(() => {
    api
      .get<CwInstance[]>("/logistics/instances")
      .then(setInstances)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load CW instances"));
  }, []);

  if (error) return <Banner tone="danger">{error}</Banner>;
  if (!instances) {
    return (
      <Card>
        <CardBody>
          <Spinner /> Loading…
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Embed links"
        action={
          <Field label="Generate links for">
            <Select value={selected} onChange={(e) => onSelect(e.target.value)}>
              <option value="" disabled>
                Select an instance…
              </option>
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
        {!selected && <Banner tone="info">Select a CW instance above before generating embed links.</Banner>}
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
                    disabled={!p.built || !selected}
                    onClick={() => {
                      navigator.clipboard.writeText(`${location.origin}${p.route}?instance=${encodeURIComponent(selected)}&embed=1`);
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
  );
}
