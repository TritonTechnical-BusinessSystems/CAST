import { useEffect, useState } from "react";
import { api } from "../api";
import { useLogisticsInstance } from "../useLogisticsInstance";
import { Card, CardHeader, CardBody, Field, Select, Input, Checkbox, Button, Banner, Spinner, useToast } from "../ui";

interface CwInstance {
  id: string;
  name: string;
}

interface ReceivingSettings {
  status_names: string[];
  week_begins_on: number;
  sync_interval_minutes: number;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Genuinely per-CW-instance, unlike every other Configuration section — PO
 * statuses are CW-instance-specific data (INIT-0026's hard safety design:
 * the instance is always an explicit, visible selection, never inferred).
 * Shares the same instance-selection mechanism (URL `?instance=` first, then
 * localStorage) as the Logistics landing page's toggle and the Shipments
 * list, so a copied embed link deep-linking to `?tab=receiving` works too.
 */
export function LogisticsConfigReceiving() {
  const toast = useToast();
  const [instances, setInstances] = useState<CwInstance[] | null>(null);
  const [instance, setInstance] = useLogisticsInstance();
  const [settings, setSettings] = useState<ReceivingSettings | null>(null);
  const [poStatuses, setPoStatuses] = useState<string[] | null>(null);
  const [poStatusError, setPoStatusError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<CwInstance[]>("/logistics/instances").then(setInstances);
  }, []);

  useEffect(() => {
    if (!instance) return;
    setSettings(null);
    setPoStatuses(null);
    setPoStatusError(null);
    api.get<ReceivingSettings>(`/logistics/${instance}/config/receiving-settings`).then(setSettings);
    api
      .get<string[]>(`/logistics/${instance}/config/po-statuses`)
      .then(setPoStatuses)
      .catch((e) => setPoStatusError(e instanceof Error ? e.message : "Failed to load PO statuses"));
  }, [instance]);

  const toggleStatus = (name: string) => {
    setSettings((s) =>
      s ? { ...s, status_names: s.status_names.includes(name) ? s.status_names.filter((n) => n !== name) : [...s.status_names, name] } : s,
    );
  };

  const save = async () => {
    if (!settings || !instance) return;
    setSaving(true);
    try {
      await api.put(`/logistics/${instance}/config/receiving-settings`, settings);
      toast("success", "Receiving settings saved.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to save receiving settings");
    } finally {
      setSaving(false);
    }
  };

  if (!instances) return <Spinner />;

  return (
    <Card>
      <CardHeader
        title="Receiving"
        action={
          <Field label="CW Instance">
            <Select value={instance} onChange={(e) => setInstance(e.target.value)}>
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
        {!instance ? (
          <Banner tone="info">Select a CW instance above to view its Receiving settings.</Banner>
        ) : !settings ? (
          <Spinner />
        ) : (
          <div className="col gap-4">
            <div className="col gap-2">
              <span className="label">Open PO statuses</span>
              <p className="hint">Which live ConnectWise Purchase Order statuses count as "open" for Receiving.</p>
              {poStatusError ? (
                <Banner tone="warning">{poStatusError}</Banner>
              ) : !poStatuses ? (
                <Spinner />
              ) : (
                <div className="col gap-2">
                  {poStatuses.map((s) => (
                    <Checkbox key={s} label={s} checked={settings.status_names.includes(s)} onChange={() => toggleStatus(s)} />
                  ))}
                </div>
              )}
            </div>

            <div className="row gap-4">
              <Field label="Week begins on">
                <Select
                  value={settings.week_begins_on}
                  onChange={(e) => setSettings((s) => (s ? { ...s, week_begins_on: Number(e.target.value) } : s))}
                >
                  {WEEKDAYS.map((d, i) => (
                    <option key={i} value={i}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Sync interval" hint="How often Receiving polls ConnectWise for PO/line-item changes.">
                <div className="row gap-2">
                  <Input
                    type="number"
                    className="w-num"
                    min={1}
                    value={settings.sync_interval_minutes}
                    onChange={(e) => setSettings((s) => (s ? { ...s, sync_interval_minutes: Number(e.target.value) || 1 } : s))}
                  />
                  <span className="muted text-sm">minutes</span>
                </div>
              </Field>
            </div>

            <div>
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save receiving settings"}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
