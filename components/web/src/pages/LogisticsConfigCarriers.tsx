import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, CardHeader, CardBody, Table, Input, Button, EmptyState, Spinner, useToast, IconPackage } from "../ui";

interface Carrier {
  id: number;
  name: string;
  sort_order: number;
}

export function LogisticsConfigCarriers() {
  const toast = useToast();
  const [carriers, setCarriers] = useState<Carrier[] | null>(null);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  const load = () => api.get<Carrier[]>("/logistics/config/carriers").then(setCarriers).catch(() => setCarriers([]));
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await api.post("/logistics/config/carriers", { name: newName.trim(), sort_order: (carriers?.length ?? 0) + 1 });
      setNewName("");
      load();
      toast("success", "Carrier added.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to add carrier");
    } finally {
      setSaving(false);
    }
  };

  const rename = async (id: number, name: string) => {
    try {
      await api.patch(`/logistics/config/carriers/${id}`, { name });
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to rename carrier");
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Remove this carrier?")) return;
    try {
      await api.del(`/logistics/config/carriers/${id}`);
      load();
      toast("success", "Carrier removed.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to remove carrier");
    }
  };

  if (!carriers) return <Spinner />;

  return (
    <Card>
      <CardHeader title="Carriers" />
      <CardBody>
        <div className="col gap-4">
          <div className="row gap-2">
            <Input
              placeholder="New carrier name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
            <Button variant="primary" onClick={add} disabled={saving || !newName.trim()}>
              Add
            </Button>
          </div>

          {carriers.length === 0 ? (
            <EmptyState icon={<IconPackage />}>No carriers configured yet.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {carriers.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Input
                        value={editing[c.id] ?? c.name}
                        onChange={(e) => setEditing((s) => ({ ...s, [c.id]: e.target.value }))}
                        onBlur={() => {
                          const name = editing[c.id]?.trim();
                          if (name && name !== c.name) rename(c.id, name);
                        }}
                      />
                    </td>
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
