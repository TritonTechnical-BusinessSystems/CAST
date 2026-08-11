import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader, Card, CardHeader, CardBody, Checkbox, Button, Input, Badge, Banner, Spinner, useToast } from "../ui";

interface Options { statuses: string[]; boards: string[]; projectStatuses: string[]; }
interface Rule {
  statuses: string[];
  boards: string[];
  projectStatuses: string[];
  requireImo: boolean;
  requireMmsi: boolean;
  autoCreateVesselSite: boolean;
}
interface TierPreview { count: number; vessels: { vesselName: string; companyName: string }[]; }
interface Preview {
  matched: number;
  tier1: TierPreview;
  tier2: TierPreview;
  excludedNoMmsi: number;
  excludedNoSite: number;
  excludedNoEngagement: number;
}
const emptyRule: Rule = {
  statuses: [],
  boards: [],
  projectStatuses: [],
  requireImo: false,
  requireMmsi: true,
  autoCreateVesselSite: false,
};

export function TrackingConfig() {
  const toast = useToast();
  const [opts, setOpts] = useState<Options | null>(null);
  const [rule, setRule] = useState<Rule>(emptyRule);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshMinutes, setRefreshMinutes] = useState<number | null>(null);
  const [savingInterval, setSavingInterval] = useState(false);
  const [cwWritesEnabled, setCwWritesEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    api.get<Options>("/tracking/options").then(setOpts).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    api.get<Rule>("/tracking/config").then(setRule).catch(() => {});
    api.get<{ minutes: number }>("/tracking/refresh-interval").then((r) => setRefreshMinutes(r.minutes)).catch(() => {});
    api.get<{ writesEnabled: boolean }>("/integrations/connectwise").then((r) => setCwWritesEnabled(r.writesEnabled)).catch(() => {});
  }, []);

  const runPreview = () => api.post<Preview>("/tracking/preview", rule).then(setPreview).catch(() => setPreview(null));

  useEffect(() => {
    const t = setTimeout(runPreview, 300);
    return () => clearTimeout(t);
  }, [rule]);

  const toggle = (key: "statuses" | "boards" | "projectStatuses", val: string) =>
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

  const saveInterval = async () => {
    if (!refreshMinutes || refreshMinutes <= 0) return;
    setSavingInterval(true);
    try {
      await api.put("/tracking/refresh-interval", { minutes: refreshMinutes });
      toast("success", `Tier 1/2 will recompute every ${refreshMinutes} minute${refreshMinutes === 1 ? "" : "s"}.`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingInterval(false);
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
        <strong>Open projects</strong> and <strong>open tickets</strong> don't affect that set — together they decide
        which already-tracked vessels actually get AIS coverage, and how much (see Preview below). A tracked vessel
        with neither gets none.
      </Banner>

      <div className="card-grid card-grid-pair">
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
      </div>

      <div className="card-grid card-grid-pair">
        <Card>
          <CardHeader title="Open projects in status" />
          <CardBody>
            <div className="col gap-3">
              <p className="muted text-sm">
                <strong>Top priority.</strong> A vessel with an open project in any checked status always fills a Tier
                1 slot before any ticket-only vessel does, most-recently-active project first.
              </p>
              <div className="col gap-2">
                {opts.projectStatuses.map((s) => (
                  <Checkbox key={s} label={s} checked={rule.projectStatuses.includes(s)} onChange={() => toggle("projectStatuses", s)} />
                ))}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Open tickets on board" />
          <CardBody>
            <div className="col gap-3">
              <p className="muted text-sm">
                <strong>Second priority.</strong> Once every open-project vessel has a Tier 1 slot, remaining slots go
                to vessels with an open ticket on any checked board, most-recently-active first.
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
        <CardHeader title="Tier refresh" />
        <CardBody>
          <div className="col gap-4">
            <div className="col gap-3">
              <p className="muted text-sm">
                How often the Tier 1/2 split recomputes in the background. Each cycle also resolves any missing
                Vessel Site — and, when auto-create is enabled below, creates one for tracked vessels that still
                don't have it. ConnectWise is only queried for vessels with no Vessel Site cached yet.
              </p>
              <div className="row gap-4">
                <div className="row gap-2">
                  <Input
                    type="number"
                    min={1}
                    className="w-num"
                    aria-label="Tier refresh interval in minutes"
                    value={refreshMinutes ?? ""}
                    onChange={(e) => setRefreshMinutes(Number(e.target.value) || null)}
                  />
                  <span className="muted text-sm">minutes</span>
                </div>
                <Button variant="secondary" onClick={saveInterval} disabled={savingInterval || !refreshMinutes}>
                  {savingInterval ? "Saving…" : "Save interval"}
                </Button>
              </div>
            </div>

            <div className="col gap-2">
              <Checkbox
                label="Automatically create a Vessel Site for any client with an MMSI and Yacht market type"
                checked={rule.autoCreateVesselSite}
                onChange={(e) => setRule((r) => ({ ...r, autoCreateVesselSite: e.target.checked }))}
              />
              {cwWritesEnabled === false && (
                <Banner tone="warning">
                  ConnectWise writes are currently disabled on the Integrations page — this option is saved but won't
                  create anything until writes are enabled.
                </Banner>
              )}
              <p className="muted text-xs">Applies on the next tier-refresh cycle, not immediately.</p>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Preview"
          action={preview && <Badge tone="brand">{preview.matched} vessels tracked</Badge>}
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
                aisstream caps a live subscription at 50 vessels. A vessel needs a Vessel Site to write results to —
                resolved automatically in the background (see Tier refresh above).
              </p>
              <TierList title="Tier 1 — real-time" hint="dedicated subscription, always on" tone="success" tier={preview.tier1} startRank={1} />
              <TierList
                title="Tier 2 — periodic"
                hint="rotated subscription, best-effort"
                tone="neutral"
                tier={preview.tier2}
                startRank={preview.tier1.count + 1}
              />
              {(preview.excludedNoMmsi > 0 || preview.excludedNoSite > 0 || preview.excludedNoEngagement > 0) && (
                <div className="col gap-1 text-sm muted">
                  {preview.excludedNoMmsi > 0 && <span>{preview.excludedNoMmsi} matched but not AIS-trackable (no valid MMSI)</span>}
                  {preview.excludedNoSite > 0 && (
                    <span>{preview.excludedNoSite} matched but no Vessel Site resolved yet (picked up on the next tier-refresh cycle)</span>
                  )}
                  {preview.excludedNoEngagement > 0 && (
                    <span>{preview.excludedNoEngagement} trackable but no open project or ticket — no AIS coverage</span>
                  )}
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
  startRank,
}: {
  title: string;
  hint: string;
  tone: "success" | "neutral";
  tier: TierPreview;
  startRank: number;
}) {
  return (
    <div className="col gap-2">
      <div className="row wrap gap-2">
        <Badge tone={tone}>{tier.count}</Badge>
        <strong>{title}</strong>
        <span className="muted text-sm">— {hint}</span>
      </div>
      {tier.vessels.length > 0 && (
        <div className="rank-columns">
          {tier.vessels.map((v, i) => (
            <div key={i} className="rank-item">
              <span className="rank-num">{startRank + i}</span>
              <span>
                {v.vesselName}
                {v.companyName !== v.vesselName && <span className="muted text-sm"> — {v.companyName}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
