import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, CardHeader, CardBody, Table, Input, Button, EmptyState, Spinner, useToast, IconPackage } from "../ui";

interface Currency {
  id: number;
  code: string;
  name: string;
  sort_order: number;
}

export function LogisticsConfigCurrencies() {
  const toast = useToast();
  const [currencies, setCurrencies] = useState<Currency[] | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => api.get<Currency[]>("/logistics/config/currencies").then(setCurrencies).catch(() => setCurrencies([]));
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    if (!code.trim() || !name.trim()) return;
    setSaving(true);
    try {
      await api.post("/logistics/config/currencies", {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        sort_order: (currencies?.length ?? 0) + 1,
      });
      setCode("");
      setName("");
      load();
      toast("success", "Currency added.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to add currency");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Remove this currency?")) return;
    try {
      await api.del(`/logistics/config/currencies/${id}`);
      load();
      toast("success", "Currency removed.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to remove currency");
    }
  };

  if (!currencies) return <Spinner />;

  return (
    <Card>
      <CardHeader title="Currencies" />
      <CardBody>
        <div className="col gap-4">
          <div className="row gap-2">
            <Input
              placeholder="Code (e.g. USD)"
              className="w-num"
              maxLength={3}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Input placeholder="Name (e.g. US Dollar)" className="grow" value={name} onChange={(e) => setName(e.target.value)} />
            <Button variant="primary" onClick={add} disabled={saving || !code.trim() || !name.trim()}>
              Add
            </Button>
          </div>

          {currencies.length === 0 ? (
            <EmptyState icon={<IconPackage />}>No currencies configured yet.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {currencies.map((c) => (
                  <tr key={c.id}>
                    <td>{c.code}</td>
                    <td>{c.name}</td>
                    <td>
                      <Button variant="ghost" size="sm" onClick={() => remove(c.id)}>
                        Remove
                      </Button>
                    </td>
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
