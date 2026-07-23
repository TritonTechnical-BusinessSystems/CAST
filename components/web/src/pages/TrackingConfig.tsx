import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader, Card, CardHeader, CardBody, Checkbox, Button, Badge, Banner, Spinner, useToast } from "../ui";

interface Options { statuses: string[]; boards: string[]; }
interface Rule { statuses: string[]; boards: string[]; requireImo: boolean; requireMmsi: boolean; }
interface Preview { count: number; sample: { vesselName: string; companyName: string }[]; }

const emptyRule: Rule = { statuses: [], boards: [], requireImo: false, requireMmsi: true };

export function TrackingConfig() {
  const toast = useToast();
  const [opts, setOpts] = useState<Options | null>(null);
  const [rule, setRule] = useState<Rule>(emptyRule);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<Options>("/tracking/options").then(setOpts).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    api.get<Rule>("/tracking/config").then(setRule).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api.post<Preview>("/tracking/preview", rule).then(setPreview).catch(() => setPreview(null));
    }, 300);
    return () => clearTimeout(t);
  }, [rule]);

  const toggle = (key: "statuses" | "boards", val: string) =>
    setRule((r) => ({ ...r, [key]: r[key].includes(val) ? r[key].filter((x) => x !== val) : [...r[key], val] }));

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/tracking/config", rule);
      toast("success", "Tracking rule saved.");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (error) return <Banner tone="danger">{error}</Banner>;
  if (!opts)
    return (
      <div className="row gap-2">
        <Spinner /> <span className="muted">Loading options from ConnectWise…</span>
      </div>
    );

  return (
    <div className="col gap-4">
      <PageHeader
        embedded
        title="Vessel Tracking Config"
        subtitle="Choose which vessels CAST follows. Options are read live from ConnectWise."
        actions={
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save rule"}
          </Button>
        }
      />
      <Banner tone="info">
        Combination: <strong>AND</strong> across groups, <strong>OR</strong> within a group. A valid MMSI is required to
        AIS-track, so "Require MMSI" is on by default.
      </Banner>

      <div className="card-grid">
        <Card>
          <CardHeader title="Company Status" />
          <CardBody>
            <div className="col gap-2">
              {opts.statuses.map((s) => (
                <Checkbox key={s} label={s} checked={rule.statuses.includes(s)} onChange={() => toggle("statuses", s)} />
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Identifiers" />
          <CardBody>
            <div className="col gap-2">
              <Checkbox label="Has a valid IMO" checked={rule.requireImo} onChange={(e) => setRule((r) => ({ ...r, requireImo: e.target.checked }))} />
              <Checkbox label="Has a valid MMSI (required to track)" checked={rule.requireMmsi} onChange={(e) => setRule((r) => ({ ...r, requireMmsi: e.target.checked }))} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Open work on board" />
          <CardBody>
            <div className="col gap-2">
              {opts.boards.map((b) => (
                <Checkbox key={b} label={b} checked={rule.boards.includes(b)} onChange={() => toggle("boards", b)} />
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Preview" action={preview && <Badge tone="brand">{preview.count} vessels match</Badge>} />
        <CardBody>
          {!preview ? (
            <span className="muted">Adjust criteria to preview…</span>
          ) : preview.sample.length === 0 ? (
            <span className="muted">No vessels match this rule.</span>
          ) : (
            <div className="col gap-2">
              {preview.sample.map((v, i) => (
                <div key={i} className="row between">
                  <strong>{v.vesselName}</strong>
                  <span className="muted text-sm">{v.companyName}</span>
                </div>
              ))}
              {preview.count > preview.sample.length && (
                <span className="muted text-sm">…and {preview.count - preview.sample.length} more</span>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
