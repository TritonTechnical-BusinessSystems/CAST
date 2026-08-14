import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, CardHeader, CardBody, Input, Textarea, Field, Button, Modal, EmptyState, Spinner, useToast, IconPackage } from "../ui";

interface CiFlag {
  id: number;
  name: string;
  content: string;
  color: string;
  font_size: number;
  sort_order: number;
}

const empty = { name: "", content: "", color: "#1e3a5f", font_size: 9 };

/**
 * CI (Commercial Invoice) Flags — reusable stamped notices (e.g. "FRAGILE",
 * "EAR99") placed on generated Commercial Invoices. Given a proper typed
 * shape here rather than LC's freeform Python dict (a safe improve-while-
 * porting opportunity — this data was never actually freeform in practice).
 */
export function LogisticsConfigCiFlags() {
  const toast = useToast();
  const [flags, setFlags] = useState<CiFlag[] | null>(null);
  const [modalFlag, setModalFlag] = useState<CiFlag | typeof empty | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => api.get<CiFlag[]>("/logistics/config/ci-flags").then(setFlags).catch(() => setFlags([]));
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!modalFlag || !modalFlag.name.trim() || !modalFlag.content.trim()) return;
    setSaving(true);
    try {
      if ("id" in modalFlag) {
        await api.put(`/logistics/config/ci-flags/${modalFlag.id}`, modalFlag);
      } else {
        await api.post("/logistics/config/ci-flags", modalFlag);
      }
      setModalFlag(null);
      load();
      toast("success", "CI flag saved.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to save CI flag");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Remove this CI flag?")) return;
    try {
      await api.del(`/logistics/config/ci-flags/${id}`);
      load();
      toast("success", "CI flag removed.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to remove CI flag");
    }
  };

  if (!flags) return <Spinner />;

  return (
    <Card>
      <CardHeader title="CI Flags" action={<Button variant="primary" size="sm" onClick={() => setModalFlag(empty)}>Add flag</Button>} />
      <CardBody>
        {flags.length === 0 ? (
          <EmptyState icon={<IconPackage />}>No CI flags configured yet.</EmptyState>
        ) : (
          <div className="col">
            {flags.map((f) => (
              <div key={f.id} className="kv">
                <div className="row gap-3">
                  <span className="color-chip" style={{ background: f.color, fontSize: f.font_size }}>
                    {f.name}
                  </span>
                  <span className="hint">{f.content}</span>
                </div>
                <div className="row gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setModalFlag(f)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(f.id)}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>

      {modalFlag && (
        <Modal
          title={"id" in modalFlag ? "Edit CI Flag" : "Add CI Flag"}
          onClose={() => setModalFlag(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalFlag(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={save} disabled={saving || !modalFlag.name.trim() || !modalFlag.content.trim()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </>
          }
        >
          <div className="col gap-3">
            <Field label="Name">
              <Input value={modalFlag.name} onChange={(e) => setModalFlag((f) => (f ? { ...f, name: e.target.value } : f))} />
            </Field>
            <Field label="Content" hint="The text stamped onto the Commercial Invoice.">
              <Textarea rows={2} value={modalFlag.content} onChange={(e) => setModalFlag((f) => (f ? { ...f, content: e.target.value } : f))} />
            </Field>
            <div className="row gap-3">
              <Field label="Color">
                <Input
                  type="color"
                  value={modalFlag.color}
                  onChange={(e) => setModalFlag((f) => (f ? { ...f, color: e.target.value } : f))}
                />
              </Field>
              <Field label="Font size">
                <Input
                  type="number"
                  className="w-num"
                  min={6}
                  max={24}
                  value={modalFlag.font_size}
                  onChange={(e) => setModalFlag((f) => (f ? { ...f, font_size: Number(e.target.value) || f.font_size } : f))}
                />
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}
