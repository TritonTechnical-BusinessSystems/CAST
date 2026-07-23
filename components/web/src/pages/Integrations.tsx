import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader, Card, CardHeader, CardBody, CardFooter, StatusDot, Button, Field, Input, Banner, Badge, Spinner, useToast } from "../ui";

type DotState = "ok" | "warn" | "down" | "idle";

interface CwStatus {
  configured: boolean;
  company: string;
  baseUrl: string;
  publicKeyMasked: string;
  clientIdMasked: string;
  imoField: string;
  mmsiField: string;
  writesEnabled: boolean;
  source: "store" | "env" | "none";
}

export function Integrations() {
  const toast = useToast();
  const [status, setStatus] = useState<CwStatus | null>(null);
  const [test, setTest] = useState<{ state: "idle" | "testing" | "ok" | "fail"; detail?: string }>({ state: "idle" });
  const [form, setForm] = useState({ company: "", publicKey: "", privateKey: "", clientId: "" });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = () => {
    api.get<CwStatus>("/integrations/connectwise").then(setStatus).catch(() => {});
  };
  useEffect(load, []);

  const runTest = async () => {
    setTest({ state: "testing" });
    try {
      const r = await api.post<{ ok: boolean; detail: string }>("/integrations/connectwise/test");
      setTest({ state: r.ok ? "ok" : "fail", detail: r.detail });
    } catch (e) {
      setTest({ state: "fail", detail: e instanceof Error ? e.message : "failed" });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/integrations/connectwise", form);
      toast("success", "Credentials saved (encrypted).");
      setEditing(false);
      setForm({ company: "", publicKey: "", privateKey: "", clientId: "" });
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!status)
    return (
      <div className="row gap-2">
        <Spinner /> <span className="muted">Loading…</span>
      </div>
    );

  const dot: DotState = test.state === "ok" ? "ok" : test.state === "fail" ? "down" : status.configured ? "idle" : "warn";

  return (
    <div className="col gap-4">
      <PageHeader title="Integrations" subtitle="Credentials for the systems CAST connects to. Stored encrypted, server-side — never shown in full." />
      <Card>
        <CardHeader
          title={
            <span className="row gap-2">
              <StatusDot state={dot} /> ConnectWise PSA
            </span>
          }
          action={
            <Button variant="secondary" onClick={runTest} disabled={test.state === "testing"}>
              {test.state === "testing" ? "Testing…" : "Test connection"}
            </Button>
          }
        />
        <CardBody>
          <div className="col gap-3">
            {!status.configured && <Banner tone="warning">Not configured yet — enter credentials below.</Banner>}
            {test.state === "ok" && <Banner tone="success">Connected. {test.detail}</Banner>}
            {test.state === "fail" && <Banner tone="danger">{test.detail}</Banner>}
            <div>
              <div className="kv"><span className="kv-key">Site</span><span className="kv-val mono">{status.baseUrl}</span></div>
              <div className="kv"><span className="kv-key">Company</span><span className="kv-val mono">{status.company || "—"}</span></div>
              <div className="kv"><span className="kv-key">Public key</span><span className="kv-val mono">{status.publicKeyMasked || "—"}</span></div>
              <div className="kv"><span className="kv-key">Client ID</span><span className="kv-val mono">{status.clientIdMasked || "—"}</span></div>
              <div className="kv"><span className="kv-key">IMO / MMSI fields</span><span className="kv-val">{status.imoField} / {status.mmsiField}</span></div>
              <div className="kv"><span className="kv-key">Source</span><span className="kv-val"><Badge tone="neutral">{status.source}</Badge></span></div>
              <div className="kv">
                <span className="kv-key">CW writes</span>
                <span className="kv-val">{status.writesEnabled ? <Badge tone="danger">ENABLED</Badge> : <Badge tone="success">disabled (safe)</Badge>}</span>
              </div>
            </div>
          </div>
        </CardBody>
        <CardFooter>
          {editing ? (
            <div className="col gap-3 grow">
              <div className="card-grid">
                <Field label="Company ID"><Input value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} placeholder={status.company} /></Field>
                <Field label="Public Key"><Input value={form.publicKey} onChange={(e) => setForm((f) => ({ ...f, publicKey: e.target.value }))} /></Field>
                <Field label="Private Key"><Input type="password" value={form.privateKey} onChange={(e) => setForm((f) => ({ ...f, privateKey: e.target.value }))} /></Field>
                <Field label="Client ID"><Input value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))} /></Field>
              </div>
              <div className="row gap-2">
                <Button variant="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save (encrypted)"}</Button>
                <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setEditing(true)}>Update credentials</Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
