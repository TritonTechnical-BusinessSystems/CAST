import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader, Card, CardHeader, CardBody, Button, Field, Input, Select, Banner, Spinner, EmptyState, Modal, useToast } from "../ui";

type Area =
  | { id: string; name: string; kind: "circle"; centerLat: number; centerLon: number; radiusKm: number }
  | { id: string; name: string; kind: "bbox"; minLat: number; minLon: number; maxLat: number; maxLon: number };

interface Config {
  areas: Area[];
  action: { type: "cw-flag" | "teams" | "none"; note: string };
}

const rid = () => Math.random().toString(36).slice(2, 9);
const newCircle = (): Area => ({ id: rid(), name: "", kind: "circle", centerLat: 0, centerLon: 0, radiusKm: 10 });

function summary(a: Area): string {
  return a.kind === "circle"
    ? `Circle · ${a.centerLat.toFixed(3)}, ${a.centerLon.toFixed(3)} · r ${a.radiusKm} km`
    : `Box · ${a.minLat.toFixed(2)},${a.minLon.toFixed(2)} → ${a.maxLat.toFixed(2)},${a.maxLon.toFixed(2)}`;
}

export function GeoAlerts() {
  const toast = useToast();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [editing, setEditing] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<Config>("/geo-alerts").then(setCfg).catch(() => setCfg({ areas: [], action: { type: "none", note: "" } }));
  }, []);

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      await api.put("/geo-alerts", cfg);
      toast("success", "Geo alerts saved.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const upsert = (a: Area) => setCfg((c) => (c ? { ...c, areas: [...c.areas.filter((x) => x.id !== a.id), a] } : c));
  const remove = (id: string) => setCfg((c) => (c ? { ...c, areas: c.areas.filter((x) => x.id !== id) } : c));

  if (!cfg)
    return (
      <div className="row gap-2">
        <Spinner /> <span className="muted">Loading…</span>
      </div>
    );

  return (
    <div className="col gap-4">
      <PageHeader
        title="Geo Alerts"
        subtitle="Define areas; when a tracked vessel enters one, fire the action."
        actions={
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        }
      />
      <Banner tone="info">
        Areas are saved now; the entry-trigger runs once the aisstream monitor is live (INIT-0012). A map-drawing UI is a
        planned enhancement — for now, enter coordinates.
      </Banner>

      <Card>
        <CardHeader
          title="Areas"
          action={
            <Button size="sm" variant="secondary" onClick={() => setEditing(newCircle())}>
              Add area
            </Button>
          }
        />
        <CardBody>
          {cfg.areas.length === 0 ? (
            <EmptyState>No areas defined yet.</EmptyState>
          ) : (
            <div className="col gap-3">
              {cfg.areas.map((a) => (
                <div key={a.id} className="row between wrap gap-2">
                  <div className="col">
                    <strong>{a.name || "(unnamed)"}</strong>
                    <span className="muted text-sm">{summary(a)}</span>
                  </div>
                  <div className="row gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(a.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Action on entry" />
        <CardBody>
          <div className="col gap-3">
            <Field label="When a tracked vessel enters an area">
              <Select
                value={cfg.action.type}
                onChange={(e) => setCfg((c) => (c ? { ...c, action: { ...c.action, type: e.target.value as Config["action"]["type"] } } : c))}
              >
                <option value="none">Do nothing (log only)</option>
                <option value="cw-flag">Flag in ConnectWise</option>
                <option value="teams">Send a Teams notification</option>
              </Select>
            </Field>
            <Field label="Note / message" hint="Included in the flag or notification.">
              <Input
                value={cfg.action.note}
                onChange={(e) => setCfg((c) => (c ? { ...c, action: { ...c.action, note: e.target.value } } : c))}
                placeholder="e.g. Vessel entered monitored zone"
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      {editing && (
        <AreaModal
          area={editing}
          onClose={() => setEditing(null)}
          onSave={(a) => {
            upsert(a);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function AreaModal({ area, onClose, onSave }: { area: Area; onClose: () => void; onSave: (a: Area) => void }) {
  const [a, setA] = useState<Area>(area);
  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <Modal
      title={area.name ? "Edit area" : "New area"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave(a)} disabled={!a.name.trim()}>
            Save area
          </Button>
        </>
      }
    >
      <div className="col gap-3">
        <Field label="Name">
          <Input value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} placeholder="e.g. Palma approach" />
        </Field>
        <Field label="Shape">
          <Select
            value={a.kind}
            onChange={(e) =>
              setA(
                e.target.value === "circle"
                  ? { id: a.id, name: a.name, kind: "circle", centerLat: 0, centerLon: 0, radiusKm: 10 }
                  : { id: a.id, name: a.name, kind: "bbox", minLat: 0, minLon: 0, maxLat: 0, maxLon: 0 },
              )
            }
          >
            <option value="circle">Circle (center + radius)</option>
            <option value="bbox">Bounding box</option>
          </Select>
        </Field>

        {a.kind === "circle" ? (
          <div className="card-grid">
            <Field label="Center latitude">
              <Input type="number" value={a.centerLat} onChange={(e) => setA({ ...a, centerLat: num(e.target.value) })} />
            </Field>
            <Field label="Center longitude">
              <Input type="number" value={a.centerLon} onChange={(e) => setA({ ...a, centerLon: num(e.target.value) })} />
            </Field>
            <Field label="Radius (km)">
              <Input type="number" value={a.radiusKm} onChange={(e) => setA({ ...a, radiusKm: num(e.target.value) })} />
            </Field>
          </div>
        ) : (
          <div className="card-grid">
            <Field label="Min latitude">
              <Input type="number" value={a.minLat} onChange={(e) => setA({ ...a, minLat: num(e.target.value) })} />
            </Field>
            <Field label="Min longitude">
              <Input type="number" value={a.minLon} onChange={(e) => setA({ ...a, minLon: num(e.target.value) })} />
            </Field>
            <Field label="Max latitude">
              <Input type="number" value={a.maxLat} onChange={(e) => setA({ ...a, maxLat: num(e.target.value) })} />
            </Field>
            <Field label="Max longitude">
              <Input type="number" value={a.maxLon} onChange={(e) => setA({ ...a, maxLon: num(e.target.value) })} />
            </Field>
          </div>
        )}
      </div>
    </Modal>
  );
}
