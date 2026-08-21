import { useEffect, useState } from "react";
import { api } from "../api";
import { useLogisticsInstance } from "../useLogisticsInstance";
import { Card, CardHeader, CardBody, Table, Field, Select, Button, Banner, EmptyState, Spinner, IconPackage } from "../ui";

interface CwInstance {
  id: string;
  name: string;
}

/**
 * Live, read-only — sourced from ConnectWise's "Shipment Carrier" ticket
 * custom field (id 70), per CW instance. Replaces the old locally-managed
 * add/rename/remove list (2026-08-19, user: "need to be a live lookup of our
 * Carriers custom field in each respective CW instance") — carriers are
 * managed in ConnectWise itself now, not duplicated here.
 */
export function LogisticsConfigCarriers() {
  const [instances, setInstances] = useState<CwInstance[] | null>(null);
  const [selected, onSelect] = useLogisticsInstance();
  const [carriers, setCarriers] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .get<CwInstance[]>("/logistics/instances")
      .then(setInstances)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load CW instances"));
  }, []);

  const load = () => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    api
      .get<string[]>(`/logistics/${selected}/config/carriers`)
      .then(setCarriers)
      .catch((e) => {
        setCarriers(null);
        setError(e instanceof Error ? e.message : "Failed to load carriers from ConnectWise");
      })
      .finally(() => setLoading(false));
  };
  useEffect(load, [selected]);

  return (
    <Card>
      <CardHeader
        title="Carriers"
        action={
          <div className="row gap-3">
            {instances && (
              <Field label="CW Instance">
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
            )}
            <Button size="sm" variant="secondary" onClick={load} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </Button>
          </div>
        }
      />
      <CardBody>
        <div className="col gap-4">
          <span className="muted text-sm">Live from ConnectWise's "Shipment Carrier" ticket field — managed in ConnectWise, not here.</span>
          {error ? (
            <Banner tone="danger">{error}</Banner>
          ) : !selected ? (
            <EmptyState icon={<IconPackage />}>Select a CW instance above to view its carriers.</EmptyState>
          ) : loading && !carriers ? (
            <Spinner />
          ) : !carriers || carriers.length === 0 ? (
            <EmptyState icon={<IconPackage />}>No carrier options found for this instance.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Name</th>
                </tr>
              </thead>
              <tbody>
                {carriers.map((name) => (
                  <tr key={name}>
                    <td>{name}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
