import { useEffect, useState } from "react";
import { api } from "../api";
import { useLogisticsInstance } from "../useLogisticsInstance";
import { Card, CardHeader, CardBody, Table, Field, Select, Button, Banner, EmptyState, Spinner, IconPackage } from "../ui";

interface CwInstance {
  id: string;
  name: string;
  isDefault: boolean;
}
interface Currency {
  code: string;
  name: string;
}

/**
 * Live, read-only — sourced from ConnectWise's Finance > Currencies setup,
 * per CW instance. Replaces the old locally-managed add/remove list
 * (2026-08-19, user: "need to come from a live CW lookup") — currencies are
 * managed in ConnectWise itself now, not duplicated here. Requires a
 * Finance-module read grant on the CW API member (`/finance/currencies`
 * 403s without it — confirmed live 2026-08-19); the error banner below
 * says so explicitly rather than failing silently.
 */
export function LogisticsConfigCurrencies() {
  const [instances, setInstances] = useState<CwInstance[] | null>(null);
  const [selected, onSelect] = useLogisticsInstance();
  const [currencies, setCurrencies] = useState<Currency[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .get<CwInstance[]>("/logistics/instances")
      .then((rows) => {
        setInstances(rows);
        if (!selected) {
          const def = rows.find((r) => r.isDefault) ?? rows[0];
          if (def) onSelect(def.id);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load CW instances"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = () => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    api
      .get<Currency[]>(`/logistics/${selected}/config/currencies`)
      .then(setCurrencies)
      .catch((e) => {
        setCurrencies(null);
        // The backend already sanitizes a CW 403 into a specific, actionable
        // message (routes/logistics.ts's cwLookupError) — show it as-is.
        setError(e instanceof Error ? e.message : "Failed to load currencies from ConnectWise");
      })
      .finally(() => setLoading(false));
  };
  useEffect(load, [selected]);

  return (
    <Card>
      <CardHeader
        title="Currencies"
        action={
          <div className="row gap-3">
            {instances && (
              <Field label="CW Instance">
                <Select value={selected} onChange={(e) => onSelect(e.target.value)}>
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
          <span className="muted text-sm">Live from ConnectWise's Finance &gt; Currencies setup — managed in ConnectWise, not here.</span>
          {error ? (
            <Banner tone="danger">{error}</Banner>
          ) : loading && !currencies ? (
            <Spinner />
          ) : !currencies || currencies.length === 0 ? (
            <EmptyState icon={<IconPackage />}>No currencies found for this instance.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                </tr>
              </thead>
              <tbody>
                {currencies.map((c) => (
                  <tr key={c.code}>
                    <td className="mono">{c.code}</td>
                    <td>{c.name}</td>
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
