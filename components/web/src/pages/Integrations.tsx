import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader, Card, CardHeader, CardBody, CardFooter, StatusDot, Button, Field, Input, Banner, Badge, Spinner, Modal, Menu, useToast } from "../ui";
import { useAuth } from "../auth";

type DotState = "ok" | "warn" | "down" | "idle";

interface CwInstance {
  id: string;
  name: string;
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

interface SimpleStatus {
  configured: boolean;
  apiKeyMasked: string;
  url: string;
  source: "store" | "none";
}

/**
 * One ConnectWise PSA instance's status + credentials — self-contained so
 * Production and Sandbox each manage their own load/test/edit state (INIT-0026,
 * 2026-08-19: "expand Integrations to make ConnectWise PSA a single
 * integration, with 2 instances"). No credential ever crosses instances here —
 * each card only ever reads/writes its own `/integrations/:instance/connectwise`.
 *
 * The writes safety toggle lives here too, per instance, not as one global
 * switch (2026-08-20, user: "The toggle for CW writes should be per instance,
 * not global" — a global switch meant enabling writes to test against
 * Sandbox also silently enabled real writes to Production).
 */
function CwInstanceCard({ instance }: { instance: CwInstance }) {
  const toast = useToast();
  const { can } = useAuth();
  const [status, setStatus] = useState<CwStatus | null>(null);
  const [test, setTest] = useState<{ state: "idle" | "testing" | "ok" | "fail"; detail?: string }>({ state: "idle" });
  const [form, setForm] = useState({ company: "", publicKey: "", privateKey: "", clientId: "", baseUrl: "" });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [togglingWrites, setTogglingWrites] = useState(false);

  const load = () => {
    api.get<CwStatus>(`/integrations/${instance.id}/connectwise`).then(setStatus).catch(() => {});
  };
  useEffect(load, [instance.id]);

  const setWrites = async (enabled: boolean) => {
    setTogglingWrites(true);
    try {
      const r = await api.put<{ writesEnabled: boolean }>(`/integrations/${instance.id}/connectwise/writes`, { enabled });
      setStatus((s) => (s ? { ...s, writesEnabled: r.writesEnabled } : s));
      toast("success", enabled ? `${instance.name}: ConnectWise writes enabled.` : `${instance.name}: ConnectWise writes disabled.`);
      setConfirmEnable(false);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to change writes setting");
    } finally {
      setTogglingWrites(false);
    }
  };

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
            {test.state === "ok" && <span className="muted text-sm">{test.detail}</span>}
          </span>
        }
        action={
          can("integrations.write") && (
            <div className="row gap-2">
              <Button variant="secondary" size="sm" onClick={runTest} disabled={test.state === "testing"}>
                {test.state === "testing" ? "Testing…" : "Test connection"}
              </Button>
              {status.configured && <Menu items={[{ label: clearing ? "Clearing…" : "Clear credentials", tone: "danger", disabled: clearing, onSelect: clearCreds }]} />}
            </div>
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
            <div className="kv"><span className="kv-key">Source</span><span className="kv-val"><Badge tone="neutral">{status.source}</Badge></span></div>
          </div>
          <div className="panel row between gap-4">
            <div>
              <div className="label">ConnectWise writes</div>
              <div className="muted text-sm">Whether CAST can save changes back to {instance.name}'s live ConnectWise records.</div>
            </div>
            <div className="row gap-2">
              {status.writesEnabled ? <Badge tone="success">ENABLED</Badge> : <Badge tone="neutral">disabled</Badge>}
              {can("integrations.write") &&
                (status.writesEnabled ? (
                  <Button size="sm" variant="secondary" onClick={() => setWrites(false)} disabled={togglingWrites}>
                    {togglingWrites ? "Disabling…" : "Disable"}
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setConfirmEnable(true)} disabled={togglingWrites}>
                    Enable…
                  </Button>
                ))}
            </div>
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
            </div>
          )
        )}
      </CardFooter>
      {confirmEnable && (
        <Modal
          title={`Enable ConnectWise writes for ${instance.name}?`}
          onClose={() => !togglingWrites && setConfirmEnable(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmEnable(false)} disabled={togglingWrites}>Cancel</Button>
              <Button variant="primary" onClick={() => setWrites(true)} disabled={togglingWrites}>
                {togglingWrites ? "Enabling…" : "Enable writes"}
              </Button>
            </>
          }
        >
          <div className="col gap-3">
            <p>
              CAST will begin writing to {instance.name}'s live ConnectWise records — vessel IMO/MMSI values, location
              updates, and Logistics documents will be saved there. This does not affect any other instance.
            </p>
            <p className="muted text-sm">You can turn writes back off from this card at any time.</p>
          </div>
        </Modal>
      )}
    </Card>
  );
}

/**
 * A single-account integration with no multi-instance concept (aisstream,
 * TrackingMore) — same encrypted-store + partial-merge + test-connection
 * shape as `CwInstanceCard`, minus the instance selection and writes toggle
 * neither provider has (2026-08-20: both moved off `.env`-only config to be
 * fully editable in-app, matching the pattern ConnectWise already uses).
 */
function SimpleIntegrationCard({
  title,
  slug,
  urlLabel,
  urlHint,
  notBuiltNote,
}: {
  title: string;
  slug: string;
  urlLabel: string;
  urlHint: string;
  notBuiltNote?: string;
}) {
  const toast = useToast();
  const { can } = useAuth();
  const [status, setStatus] = useState<SimpleStatus | null>(null);
  const [test, setTest] = useState<{ state: "idle" | "testing" | "ok" | "fail"; detail?: string }>({ state: "idle" });
  const [form, setForm] = useState({ apiKey: "", url: "" });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = () => {
    api.get<SimpleStatus>(`/integrations/${slug}`).then(setStatus).catch(() => {});
  };
  useEffect(load, []);

  const runTest = async () => {
    setTest({ state: "testing" });
    try {
      const r = await api.post<{ ok: boolean; detail: string }>(`/integrations/${slug}/test`);
      setTest({ state: r.ok ? "ok" : "fail", detail: r.detail });
    } catch (e) {
      setTest({ state: "fail", detail: e instanceof Error ? e.message : "failed" });
    }
  };

  useEffect(() => {
    if (can("integrations.write") && status?.configured && test.state === "idle") runTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/integrations/${slug}`, form);
      toast("success", `${title} credentials saved (encrypted).`);
      setEditing(false);
      setForm({ apiKey: "", url: "" });
      setTest({ state: "idle" });
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const clearCreds = async () => {
    if (!confirm(`Clear the stored ${title} API key? This cannot be undone — you'll need to re-enter it.`)) return;
    setClearing(true);
    try {
      await api.del(`/integrations/${slug}`);
      toast("success", `${title} credentials cleared.`);
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
        <CardHeader title={title} />
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
            <StatusDot state={dot} /> {title}
            {test.state === "ok" && <span className="muted text-sm">{test.detail}</span>}
          </span>
        }
        action={
          can("integrations.write") && (
            <div className="row gap-2">
              <Button variant="secondary" size="sm" onClick={runTest} disabled={test.state === "testing"}>
                {test.state === "testing" ? "Testing…" : "Test connection"}
              </Button>
              {status.configured && <Menu items={[{ label: clearing ? "Clearing…" : "Clear credentials", tone: "danger", disabled: clearing, onSelect: clearCreds }]} />}
            </div>
          )
        }
      />
      <CardBody>
        <div className="col gap-3">
          {notBuiltNote && <Banner tone="info">{notBuiltNote}</Banner>}
          {!status.configured && <Banner tone="warning">Not configured yet — enter credentials below.</Banner>}
          {test.state === "fail" && <Banner tone="danger">{test.detail}</Banner>}
          <div>
            <div className="kv"><span className="kv-key">{urlLabel}</span><span className="kv-val mono">{status.url || "—"}</span></div>
            <div className="kv"><span className="kv-key">API key</span><span className="kv-val mono">{status.apiKeyMasked || "—"}</span></div>
            <div className="kv"><span className="kv-key">Source</span><span className="kv-val"><Badge tone="neutral">{status.source}</Badge></span></div>
          </div>
        </div>
      </CardBody>
      <CardFooter>
        {editing ? (
          <div className="col gap-3 grow">
            <span className="muted text-sm">Leave a field blank to keep its current value — only what you type here changes.</span>
            <div className="card-grid">
              <Field label={urlLabel} hint={urlHint}>
                <Input value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder={status.url || "required"} />
              </Field>
              <Field label="API Key"><Input type="password" value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} placeholder={status.configured ? "unchanged" : "required"} /></Field>
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
            </div>
          )
        )}
      </CardFooter>
    </Card>
  );
}

export function Integrations() {
  const [instances, setInstances] = useState<CwInstance[] | null>(null);

  useEffect(() => {
    api.get<CwInstance[]>("/integrations/instances").then(setInstances).catch(() => setInstances([]));
  }, []);

  return (
    <div className="col gap-4">
      <PageHeader title="Integrations" subtitle="Credentials for the systems CAST connects to. Stored encrypted, server-side — never shown in full." />

      <div className="col gap-3">
        <span className="label">ConnectWise PSA</span>
        {!instances ? (
          <Spinner />
        ) : (
          <div className="card-grid card-grid-pair">
            {instances.map((i) => (
              <CwInstanceCard key={i.id} instance={i} />
            ))}
          </div>
        )}
      </div>

      <div className="col gap-3">
        <span className="label">Vessel Tracking</span>
        <div className="card-grid card-grid-pair">
          <SimpleIntegrationCard title="aisstream.io" slug="aisstream" urlLabel="WS URL" urlHint="e.g. wss://stream.aisstream.io/v0/stream" />
        </div>
      </div>

      <div className="col gap-3">
        <span className="label">Shipment Tracking</span>
        <div className="card-grid card-grid-pair">
          <SimpleIntegrationCard
            title="TrackingMore"
            slug="trackingmore"
            urlLabel="Base URL"
            urlHint="e.g. https://api.trackingmore.com/v4"
            notBuiltNote="Not yet built (INIT-0018) — credentials can be entered now, but nothing syncs against them yet."
          />
        </div>
      </div>
    </div>
  );
}
