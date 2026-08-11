import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader, Card, CardHeader, CardBody, Checkbox, Button, Badge, Banner, Spinner, useToast } from "../ui";

interface Options { statuses: string[]; boards: string[]; }
interface Rule { statuses: string[]; boards: string[]; requireImo: boolean; requireMmsi: boolean; }
interface TierPreview { count: number; sample: { vesselName: string; companyName: string }[]; }
interface Preview {
  matched: number;
  tier1: TierPreview;
  tier2: TierPreview;
  excludedNoMmsi: number;
  excludedNoSite: number;
  excludedManually: number;
}
interface SiteResolveSummary {
  checked: number;
  kept: number;
  resolved: number;
  cleared: number;
  none: number;
  ambiguous: { vesselName: string; companyName: string }[];
}

const emptyRule: Rule = { statuses: [], boards: [], requireImo: false, requireMmsi: true };

export function TrackingConfig() {
  const toast = useToast();
  const [opts, setOpts] = useState<Options | null>(null);
  const [rule, setRule] = useState<Rule>(emptyRule);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resolvingSites, setResolvingSites] = useState(false);

  useEffect(() => {
    api.get<Options>("/tracking/options").then(setOpts).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    api.get<Rule>("/tracking/config").then(setRule).catch(() => {});
  }, []);

  const runPreview = () => api.post<Preview>("/tracking/preview", rule).then(setPreview).catch(() => setPreview(null));

  useEffect(() => {
    const t = setTimeout(runPreview, 300);
    return () => clearTimeout(t);
  }, [rule]);

  const resolveSites = async () => {
    setResolvingSites(true);
    try {
      const r = await api.post<SiteResolveSummary>("/tracking/sites/resolve");
      toast(
        "success",
        `Checked ${r.checked}: ${r.kept} unchanged, ${r.resolved} resolved, ${r.cleared} cleared, ${r.none} still without a Vessel site.` +
          (r.ambiguous.length ? ` ${r.ambiguous.length} had more than one active "Vessel..." site — used the lowest id.` : ""),
      );
      await runPreview();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Site resolution failed");
    } finally {
      setResolvingSites(false);
    }
  };

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
        <strong>Company Status</strong> and <strong>Identifiers</strong> define which vessels CAST tracks at all (AND
        across groups, OR within a group). A valid MMSI is required to AIS-track, so "Require MMSI" is on by default.{" "}
        <strong>Open work on board</strong> doesn't affect that set — it decides which already-tracked vessels get
        real-time coverage vs. periodic (see Preview below).
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
            <div className="col gap-3">
              <p className="muted text-sm">
                Vessels with an open ticket on any checked board get promoted to real-time (Tier 1) coverage in the AIS
                monitor, ahead of vessels with none. Doesn't remove anyone from tracking.
              </p>
              <div className="col gap-2">
                {opts.boards.map((b) => (
                  <Checkbox key={b} label={b} checked={rule.boards.includes(b)} onChange={() => toggle("boards", b)} />
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Preview"
          action={
            <div className="row wrap gap-2">
              {preview && <Badge tone="brand">{preview.matched} vessels tracked</Badge>}
              <Button size="sm" variant="secondary" onClick={resolveSites} disabled={resolvingSites}>
                {resolvingSites ? "Resolving…" : "Resolve vessel sites"}
              </Button>
            </div>
          }
        />
        <CardBody>
          {!preview ? (
            <span className="muted">Adjust criteria to preview…</span>
          ) : preview.matched === 0 ? (
            <span className="muted">No vessels match this rule.</span>
          ) : (
            <div className="col gap-4">
              {/* aisstream caps a live subscription at 50 vessels, so the tracked set splits
                  into two tiers — knowledge/architecture/vessel-location-updating-aisstream.md §3.6 */}
              <p className="muted text-sm">
                aisstream caps a live subscription at 50 vessels, so the tracked set splits into two tiers. A vessel
                needs a CW site named "Vessel…" to write results to — use <strong>Resolve vessel sites</strong> after
                changing criteria or CW's sites.
              </p>
              <TierList title="Tier 1 — real-time" hint="dedicated subscription, always on" tone="success" tier={preview.tier1} />
              <TierList title="Tier 2 — periodic" hint="rotated subscription, best-effort" tone="neutral" tier={preview.tier2} />
              {(preview.excludedNoMmsi > 0 || preview.excludedNoSite > 0 || preview.excludedManually > 0) && (
                <div className="col gap-1 text-sm muted">
                  {preview.excludedNoMmsi > 0 && <span>{preview.excludedNoMmsi} matched but not AIS-trackable (no valid MMSI)</span>}
                  {preview.excludedNoSite > 0 && (
                    <span>{preview.excludedNoSite} matched but no Vessel site resolved yet (try Resolve vessel sites)</span>
                  )}
                  {preview.excludedManually > 0 && <span>{preview.excludedManually} manually excluded</span>}
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function TierList({
  title,
  hint,
  tone,
  tier,
}: {
  title: string;
  hint: string;
  tone: "success" | "neutral";
  tier: TierPreview;
}) {
  return (
    <div className="col gap-2">
      <div className="row wrap gap-2">
        <Badge tone={tone}>{tier.count}</Badge>
        <strong>{title}</strong>
        <span className="muted text-sm">— {hint}</span>
      </div>
      {tier.sample.length > 0 && (
        <div className="col gap-1">
          {tier.sample.map((v, i) => (
            <div key={i} className="row gap-2">
              <span>{v.vesselName}</span>
              {v.companyName !== v.vesselName && <span className="muted text-sm">{v.companyName}</span>}
            </div>
          ))}
          {tier.count > tier.sample.length && <span className="muted text-sm">…and {tier.count - tier.sample.length} more</span>}
        </div>
      )}
    </div>
  );
}
