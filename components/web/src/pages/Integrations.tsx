import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader, Card, CardHeader, CardBody, CardFooter, StatusDot, Button, Field, Input, Banner, Badge, Spinner, Modal, useToast } from "../ui";
import { useAuth } from "../auth";

type DotState = "ok" | "warn" | "down" | "idle";

interface CwInstance {
  id: string;
  name: string;
  isDefault: boolean;
}

interface CwStatus {
  configured: boolean;
  company: string;
  baseUrl: string;
  publicKeyMasked: string;
  clientId: string;
  writesEnabled: boolean;
  source: "store" | "none";
}

/**
 * One ConnectWise PSA instance's status + credentials — self-contained so
 * Production and Sandbox each manage their own load/test/edit state (INIT-0026,
 * 2026-08-19: "expand Integrations to make ConnectWise PSA a single
 * integration, with 2 instances"). No credential ever crosses instances here —
 * each card only ever reads/writes its own `/integrations/:instance/connectwise`.
 */
function CwInstanceCard({ instance, showFieldCaptions }: { instance: CwInstance; showFieldCaptions?: { imo: string; mmsi: string } }) {
  const toast = useToast();
  const { can } = useAuth();
  const [status, setStatus] = useState<CwStatus | null>(null);
  const [test, setTest] = useState<{ state: "idle" | "testing" | "ok" | "fail"; detail?: string }>({ state: "idle" });
  const [form, setForm] = useState({ company: "", publicKey: "", privateKey: "", clientId: "", baseUrl: "" });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = () => {
    api.get<CwStatus>(`/integrations/${instance.id}/connectwise`).then(setStatus).catch(() => {});
  };
  useEffect(load, [instance.id]);

  const runTest = async () => {
    setTest({ state: "testing" });
    try {
      const r = await api.post<{ ok: boolean; detail: string }>(`/integrations/${instance.id}/connectwise/test`);
      setTest({ state: r.ok ? "ok" : "fail", detail: r.detail });
    } catch (e) {
      setTest({ state: "fail", detail: e instanceof Error ? e.message : "failed" });
    }
  };

  // Run the live check once on arrival, same as System Health's own probe —
  // otherwise the dot sits idle-grey here while /health independently shows
  // ConnectWise as connected, disagreeing about the same fact. Gated on
  // integrations.write (the test route's own permission, tightened in the
  // pre-release security gate 2026-08-19 — it returns ConnectWise's raw
  // error detail, not for every authenticated viewer) — the nav only HIDES
  // this page from lower-privileged users, it doesn't block direct
  // navigation, so this page must degrade gracefully for them too.
  useEffect(() => {
    if (can("integrations.write") && status?.configured && test.state === "idle") runTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/integrations/${instance.id}/connectwise`, form);
      toast("success", `${instance.name} credentials saved (encrypted).`);
      setEditing(false);
      setForm({ company: "", publicKey: "", privateKey: "", clientId: "", baseUrl: "" });
      setTest({ state: "idle" });
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const clearCreds = async () => {
    if (!confirm(`Clear ALL stored credentials for ${instance.name}? This cannot be undone — you'll need to re-enter everything.`)) return;
    setClearing(true);
    try {
      await api.del(`/integrations/${instance.id}/connectwise`);
      toast("success", `${instance.name} credentials cleared.`);
      setTest({ state: "idle" });
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Clear failed");
    } finally {
      setClearing(false);
    }
  };

  if (!status) {
    return (
      <Card>
        <CardHeader title={instance.name} />
        <CardBody>
          <Spinner />
        </CardBody>
      </Card>
    );
  }

  const dot: DotState = test.state === "ok" ? "ok" : test.state === "fail" ? "down" : status.configured ? "idle" : "warn";

  return (
    <Card>
      <CardHeader
        title={
          <span className="row gap-2">
            <StatusDot state={dot} /> {instance.name}
            {instance.isDefault && <Badge tone="neutral">default</Badge>}
            {test.state === "ok" && <span className="muted text-sm">{test.detail}</span>}
          </span>
        }
        action={
          can("integrations.write") && (
            <Button variant="secondary" size="sm" onClick={runTest} disabled={test.state === "testing"}>
              {test.state === "testing" ? "Testing…" : "Test connection"}
            </Button>
          )
        }
      />
      <CardBody>
        <div className="col gap-3">
          {!status.configured && <Banner tone="warning">Not configured yet — enter credentials below.</Banner>}
          {test.state === "fail" && <Banner tone="danger">{test.detail}</Banner>}
          <div>
            <div className="kv"><span className="kv-key">Site</span><span className="kv-val mono">{status.baseUrl || "—"}</span></div>
            <div className="kv"><span className="kv-key">Company</span><span className="kv-val mono">{status.company || "—"}</span></div>
            <div className="kv"><span className="kv-key">Public key</span><span className="kv-val mono">{status.publicKeyMasked || "—"}</span></div>
            <div className="kv"><span className="kv-key">Client ID</span><span className="kv-val mono">{status.clientId || "—"}</span></div>
            {showFieldCaptions && (
              <div className="kv"><span className="kv-key">IMO / MMSI fields</span><span className="kv-val">{showFieldCaptions.imo} / {showFieldCaptions.mmsi}</span></div>
            )}
            <div className="kv"><span className="kv-key">Source</span><span className="kv-val"><Badge tone="neutral">{status.source}</Badge></span></div>
          </div>
        </div>
      </CardBody>
      <CardFooter>
        {editing ? (
          <div className="col gap-3 grow">
            <span className="muted text-sm">Leave a field blank to keep its current value — only what you type here changes.</span>
            <div className="card-grid">
              <Field label="Site (Base URL)" hint="e.g. https://na.myconnectwise.net/v4_6_release/apis/3.0">
                <Input value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} placeholder={status.baseUrl || "required — no default"} />
              </Field>
              <Field label="Company ID"><Input value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} placeholder={status.company || "required"} /></Field>
              <Field label="Public Key"><Input value={form.publicKey} onChange={(e) => setForm((f) => ({ ...f, publicKey: e.target.value }))} placeholder={status.publicKeyMasked || "required"} /></Field>
              <Field label="Private Key"><Input type="password" value={form.privateKey} onChange={(e) => setForm((f) => ({ ...f, privateKey: e.target.value }))} placeholder={status.configured ? "unchanged" : "required"} /></Field>
              <Field label="Client ID"><Input value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))} placeholder={status.clientId || "required"} /></Field>
            </div>
            <div className="row gap-2">
              <Button variant="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save (encrypted)"}</Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          can("integrations.write") && (
            <div className="row gap-2">
              <Button variant="secondary" onClick={() => setEditing(true)}>Update credentials</Button>
              {status.configured && (
                <Button variant="danger" onClick={clearCreds} disabled={clearing}>{clearing ? "Clearing…" : "Clear credentials"}</Button>
              )}
            </div>
          )
        )}
      </CardFooter>
    </Card>
  );
}

export function Integrations() {
  const toast = useToast();
  const { can } = useAuth();
  const [instances, setInstances] = useState<CwInstance[] | null>(null);
  const [vesselFields, setVesselFields] = useState<{ imo: string; mmsi: string } | null>(null);
  const [writesEnabled, setWritesEnabledState] = useState<boolean | null>(null);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [togglingWrites, setTogglingWrites] = useState(false);

  useEffect(() => {
    api.get<CwInstance[]>("/integrations/instances").then(setInstances).catch(() => setInstances([]));
    api.get<{ imo: string; mmsi: string }>("/integrations/vessel-fields").then(setVesselFields).catch(() => {});
    // The writes flag is global, so any one instance's status carries it —
    // Production, since it's always registered.
    api.get<CwStatus>("/integrations/tritontech/connectwise").then((s) => setWritesEnabledState(s.writesEnabled)).catch(() => {});
  }, []);

  const setWrites = async (enabled: boolean) => {
    setTogglingWrites(true);
    try {
      const r = await api.put<{ writesEnabled: boolean }>("/integrations/connectwise/writes", { enabled });
      setWritesEnabledState(r.writesEnabled);
      toast(enabled ? "warning" : "success", enabled ? "ConnectWise writes are now ENABLED." : "ConnectWise writes disabled.");
      setConfirmEnable(false);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to change writes setting");
    } finally {
      setTogglingWrites(false);
    }
  };

  return (
    <div className="col gap-4">
      <PageHeader title="Integrations" subtitle="Credentials for the systems CAST connects to. Stored encrypted, server-side — never shown in full." />

      {writesEnabled !== null && (
        <Card>
          <CardBody>
            <div className="panel row between gap-4">
              <div>
                <div className="label">ConnectWise writes</div>
                <div className="muted text-sm">Whether CAST can save changes back to live ConnectWise records — applies to every instance above.</div>
              </div>
              <div className="row gap-2">
                {writesEnabled ? <Badge tone="danger">ENABLED</Badge> : <Badge tone="success">disabled (safe)</Badge>}
                {can("integrations.write") &&
                  (writesEnabled ? (
                    <Button size="sm" variant="danger" onClick={() => setWrites(false)} disabled={togglingWrites}>
                      {togglingWrites ? "Disabling…" : "Disable"}
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setConfirmEnable(true)} disabled={togglingWrites}>
                      Enable…
                    </Button>
                  ))}
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="col gap-3">
        <span className="label">ConnectWise PSA</span>
        {!instances ? (
          <Spinner />
        ) : (
          <div className="card-grid card-grid-pair">
            {instances.map((i) => (
              <CwInstanceCard key={i.id} instance={i} showFieldCaptions={i.isDefault ? (vesselFields ?? undefined) : undefined} />
            ))}
          </div>
        )}
      </div>

      {confirmEnable && (
        <Modal
          title="Enable ConnectWise writes?"
          onClose={() => !togglingWrites && setConfirmEnable(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmEnable(false)} disabled={togglingWrites}>Cancel</Button>
              <Button variant="danger" onClick={() => setWrites(true)} disabled={togglingWrites}>
                {togglingWrites ? "Enabling…" : "Enable writes"}
              </Button>
            </>
          }
        >
          <div className="col gap-3">
            <p>
              CAST will begin writing to your live ConnectWise instances — vessel IMO/MMSI values, location updates, and
              Logistics documents will be saved to real records.
            </p>
            <p className="muted text-sm">
              Until now CAST has been read-only. You can turn writes back off from this page at any time.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
