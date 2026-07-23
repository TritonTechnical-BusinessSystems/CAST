import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader, Card, CardHeader, CardBody, StatusDot, Badge, Banner, Button, Spinner, Table, EmptyState } from "../ui";

type Health = "ok" | "warn" | "down" | "idle";
interface Probe { state: Health; detail: string; }
interface FullHealth {
  app: { version: string; build: string; env: string };
  integrations: { connectwise: Probe; aisstream: Probe; activeDirectory: Probe };
  sync: Probe;
  cwWrites: boolean;
}

function ProbeCard({ title, probe }: { title: string; probe: Probe }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="row gap-2">
            <StatusDot state={probe.state} /> {title}
          </span>
        }
      />
      <CardBody>
        <span className="muted text-sm">{probe.detail}</span>
      </CardBody>
    </Card>
  );
}

interface PkgResult { name: string; version: string; layer: string; vulnCount: number; severity: string; osvUrl: string; }

function sevTone(sev: string, count: number): "success" | "warning" | "danger" {
  if (count === 0) return "success";
  const s = sev.toUpperCase();
  return s === "CRITICAL" || s === "HIGH" ? "danger" : "warning";
}

function PackagesCard() {
  const [pkgs, setPkgs] = useState<PkgResult[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setErr(null);
    api
      .get<{ packages: PkgResult[] }>("/health/packages")
      .then((r) => setPkgs(r.packages))
      .catch((e) => setErr(e instanceof Error ? e.message : "Scan failed"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const flagged = pkgs?.filter((p) => p.vulnCount > 0).length ?? 0;

  return (
    <Card>
      <CardHeader
        title={
          <span className="row gap-2">
            Package Manifest
            {pkgs &&
              (flagged ? <Badge tone="danger">{flagged} with advisories</Badge> : <Badge tone="success">no known advisories</Badge>)}
          </span>
        }
        action={
          <Button size="sm" variant="secondary" onClick={load} disabled={loading}>
            {loading ? "Checking…" : "Re-check"}
          </Button>
        }
      />
      {loading && !pkgs ? (
        <div className="card-body row gap-2">
          <Spinner /> <span className="muted">Scanning OSV.dev…</span>
        </div>
      ) : err ? (
        <EmptyState>{err}</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Package</th>
              <th>Version</th>
              <th>Layer</th>
              <th>Advisories (OSV.dev)</th>
            </tr>
          </thead>
          <tbody>
            {pkgs!.map((p) => (
              <tr key={p.name}>
                <td data-label="Package">
                  <a href={p.osvUrl} target="_blank" rel="noreferrer">{p.name}</a>
                </td>
                <td data-label="Version" className="mono">{p.version}</td>
                <td data-label="Layer">
                  <Badge tone="neutral">{p.layer}</Badge>
                </td>
                <td data-label="Advisories">
                  {p.vulnCount > 0 ? (
                    <Badge tone={sevTone(p.severity, p.vulnCount)}>
                      {p.vulnCount} · {p.severity || "?"}
                    </Badge>
                  ) : (
                    <Badge tone="success">clean</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export function SystemHealth() {
  const [h, setH] = useState<FullHealth | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    api.get<FullHealth>("/health/full").then(setH).catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"));
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="col gap-4">
      <PageHeader
        title="System Health"
        subtitle="Live status of CAST's integrations and services."
        actions={<Button variant="secondary" onClick={load}>Refresh</Button>}
      />
      {err ? (
        <Banner tone="danger">{err}</Banner>
      ) : !h ? (
        <div className="row gap-2">
          <Spinner /> <span className="muted">Loading…</span>
        </div>
      ) : (
        <>
          <div className="card-grid">
            <ProbeCard title="ConnectWise API" probe={h.integrations.connectwise} />
            <ProbeCard title="aisstream (AIS feed)" probe={h.integrations.aisstream} />
            <ProbeCard title="Active Directory" probe={h.integrations.activeDirectory} />
            <ProbeCard title="Vessel sync job" probe={h.sync} />
          </div>
          <Card>
            <CardHeader title="Application" />
            <CardBody>
              <div className="kv"><span className="kv-key">Version</span><span className="kv-val mono">{h.app.version}</span></div>
              <div className="kv"><span className="kv-key">Build</span><span className="kv-val mono">{h.app.build}</span></div>
              <div className="kv"><span className="kv-key">Environment</span><span className="kv-val">{h.app.env}</span></div>
              <div className="kv">
                <span className="kv-key">ConnectWise writes</span>
                <span className="kv-val">{h.cwWrites ? <Badge tone="danger">ENABLED</Badge> : <Badge tone="success">disabled (safe)</Badge>}</span>
              </div>
            </CardBody>
          </Card>
          <PackagesCard />
        </>
      )}
    </div>
  );
}
