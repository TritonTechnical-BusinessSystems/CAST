import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, CardHeader, CardBody, Input, Textarea, Field, Button, EmptyState, Spinner, useToast, IconPackage } from "../ui";

interface ExportPreset {
  id: number;
  name: string;
  content: string;
  sort_order: number;
}

export function LogisticsConfigExportPresets() {
  const toast = useToast();
  const [presets, setPresets] = useState<ExportPreset[] | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => api.get<ExportPreset[]>("/logistics/config/export-presets").then(setPresets).catch(() => setPresets([]));
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    if (!name.trim() || !content.trim()) return;
    setSaving(true);
    try {
      await api.post("/logistics/config/export-presets", {
        name: name.trim(),
        content: content.trim(),
        sort_order: (presets?.length ?? 0) + 1,
      });
      setName("");
      setContent("");
      load();
      toast("success", "Export statement preset added.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to add preset");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Remove this export statement preset?")) return;
    try {
      await api.del(`/logistics/config/export-presets/${id}`);
      load();
      toast("success", "Preset removed.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to remove preset");
    }
  };

  if (!presets) return <Spinner />;

  return (
    <Card>
      <CardHeader title="Export Statement Presets" />
      <CardBody>
        <div className="col gap-4">
          <div className="col gap-2">
            <Field label="Preset name">
              <Input placeholder="e.g. Standard EAR99" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Statement text" hint="Appears on the Commercial Invoice when this preset is selected.">
              <Textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} />
            </Field>
            <Button variant="primary" onClick={add} disabled={saving || !name.trim() || !content.trim()}>
              Add preset
            </Button>
          </div>

          {presets.length === 0 ? (
            <EmptyState icon={<IconPackage />}>No export statement presets configured yet.</EmptyState>
          ) : (
            <div className="col">
              {presets.map((p) => (
                <div key={p.id} className="kv">
                  <div className="col gap-1 grow">
                    <strong>{p.name}</strong>
                    <span className="hint">{p.content}</span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => remove(p.id)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
