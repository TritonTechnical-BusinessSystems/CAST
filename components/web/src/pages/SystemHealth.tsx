import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import {
  PageHeader, Card, CardHeader, CardBody, StatusDot, Badge, Banner, Button, Spinner, Table, EmptyState,
  Gauge, RadialGauge, TimeSeriesChart, type ChartSeries,
} from "../ui";
import { ago } from "../ago";
import { formatBytes, formatBytesPerSec, formatDuration } from "../format";

type Health = "ok" | "warn" | "down" | "idle";
interface Probe { state: Health; detail: string; }
interface FullHealth {
  app: { version: string; build: string; env: string; uptimeSeconds: number; dbSizeBytes: number };
  integrations: { connectwise: Probe; aisstream: Probe; activeDirectory: Probe; aisTier1: Probe; aisTier2: Probe };
  infra: { tls: Probe; backups: Probe };
  backpressure: Probe;
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

interface ContainerMetric {
  name: string;
  cpuPercent: number;
  memUsedBytes: number;
  memLimitBytes: number;
  memPercent: number;
  blockReadBytesPerSec: number;
  blockWriteBytesPerSec: number;
  netRxBytesPerSec: number;
  netTxBytesPerSec: number;
}

interface MetricSample {
  at: string;
  cpuPercent: number;
  cpuCoreCount: number;
  memUsedBytes: number;
  memLimitBytes: number;
  memPercent: number;
  diskReadBytesPerSec: number;
  diskWriteBytesPerSec: number;
  netRxBytesPerSec: number;
  netTxBytesPerSec: number;
  storageUsedBytes: number;
  storageTotalBytes: number;
  storagePercent: number;
  eventLoopLagMeanMs: number;
  eventLoopLagP99Ms: number;
  eventLoopLagMaxMs: number;
  containers: ContainerMetric[];
}

interface MetricsResponse { intervalSeconds: number; samples: MetricSample[]; }

const RANGE_OPTIONS = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "3h", minutes: 180 },
];

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-tile-value mono">{value}</span>
      <span className="stat-tile-label">{label}</span>
    </div>
  );
}

/**
 * Resource-usage gauges + time-series charts (dataviz skill). CPU/memory/
 * disk-IO/network come from per-container docker stats via the read-only
 * docker-proxy; storage from a statfs on the data bind mount. See
 * components/api/src/health/metrics.ts for how each is derived — none of
 * this is os.totalmem()/loadavg(), which report the HOST's raw numbers even
 * from inside a container and would misrepresent this stack's own footprint.
 */
function ResourceUsage({ metrics, err }: { metrics: MetricsResponse | null; err: string | null }) {
  const [rangeMinutes, setRangeMinutes] = useState(60);

  if (err) return <Banner tone="danger">{err}</Banner>;
  if (!metrics) {
    return (
      <div className="row gap-2">
        <Spinner /> <span className="muted">Loading resource usage…</span>
      </div>
    );
  }

  const sliceCount = Math.min(metrics.samples.length, Math.round((rangeMinutes * 60) / metrics.intervalSeconds));
  const windowed = metrics.samples.slice(-sliceCount);
  const latest = windowed.length ? windowed[windowed.length - 1] : null;
  const timestamps = windowed.map((s) => s.at);
  const cores = latest?.cpuCoreCount || 1;

  const series1 = "var(--chart-series-1)";
  const series2 = "var(--chart-series-2)";
  const pct = (v: number) => `${v.toFixed(1)}%`;
  const ms = (v: number) => `${v.toFixed(1)} ms`;

  const cpuSeries: ChartSeries[] = [{ key: "cpu", label: "CPU", color: series1, values: windowed.map((s) => s.cpuPercent / cores) }];
  const memSeries: ChartSeries[] = [{ key: "mem", label: "Memory", color: series1, values: windowed.map((s) => s.memPercent) }];
  const lagSeries: ChartSeries[] = [
    { key: "mean", label: "Mean", color: series1, values: windowed.map((s) => s.eventLoopLagMeanMs) },
    { key: "p99", label: "P99", color: series2, values: windowed.map((s) => s.eventLoopLagP99Ms) },
  ];
  const diskSeries: ChartSeries[] = [
    { key: "read", label: "Read", color: series1, values: windowed.map((s) => s.diskReadBytesPerSec) },
    { key: "write", label: "Write", color: series2, values: windowed.map((s) => s.diskWriteBytesPerSec) },
  ];
  const netSeries: ChartSeries[] = [
    { key: "rx", label: "Received", color: series1, values: windowed.map((s) => s.netRxBytesPerSec) },
    { key: "tx", label: "Sent", color: series2, values: windowed.map((s) => s.netTxBytesPerSec) },
  ];

  return (
    <div className="col gap-4">
      <div className="row gap-2">
        <span className="muted text-sm">Range</span>
        {RANGE_OPTIONS.map((o) => (
          <Button key={o.label} size="sm" variant={rangeMinutes === o.minutes ? "primary" : "secondary"} onClick={() => setRangeMinutes(o.minutes)}>
            {o.label}
          </Button>
        ))}
      </div>

      {!latest ? (
        <EmptyState>Collecting samples — resource-usage charts populate within a minute of startup.</EmptyState>
      ) : (
        <>
          <div className="card-grid card-grid-compact">
            <Card>
              <CardBody className="row gap-4">
                <RadialGauge percent={latest.cpuPercent / cores} value={pct(latest.cpuPercent / cores)} label="CPU" />
                <span className="muted text-sm">Of {cores}-core capacity, summed across containers</span>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="row gap-4">
                <RadialGauge percent={latest.memPercent} value={pct(latest.memPercent)} label="Memory" />
                <span className="muted text-sm">{formatBytes(latest.memUsedBytes)} of {formatBytes(latest.memLimitBytes)}</span>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="row gap-4">
                <RadialGauge percent={latest.storagePercent} value={pct(latest.storagePercent)} label="Storage" />
                <span className="muted text-sm">{formatBytes(latest.storageUsedBytes)} of {formatBytes(latest.storageTotalBytes)}</span>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <StatTile value={ms(latest.eventLoopLagMeanMs)} label={`Event-loop lag (mean) · p99 ${ms(latest.eventLoopLagP99Ms)}`} />
              </CardBody>
            </Card>
          </div>

          <div className="card-grid card-grid-pair">
            <Card>
              <CardHeader title="CPU usage" action={<span className="muted text-xs">% of total capacity</span>} />
              <CardBody><TimeSeriesChart timestamps={timestamps} series={cpuSeries} formatValue={pct} yMax={100} /></CardBody>
            </Card>
            <Card>
              <CardHeader title="Memory usage" action={<span className="muted text-xs">% of container limit</span>} />
              <CardBody><TimeSeriesChart timestamps={timestamps} series={memSeries} formatValue={pct} yMax={100} /></CardBody>
            </Card>
            <Card>
              <CardHeader title="Event-loop lag" action={<span className="muted text-xs">aisstream backpressure signal</span>} />
              <CardBody><TimeSeriesChart timestamps={timestamps} series={lagSeries} formatValue={ms} /></CardBody>
            </Card>
            <Card>
              <CardHeader title="Disk I/O" action={<span className="muted text-xs">block read/write throughput</span>} />
              <CardBody><TimeSeriesChart timestamps={timestamps} series={diskSeries} formatValue={formatBytesPerSec} /></CardBody>
            </Card>
            <Card>
              <CardHeader title="Network I/O" action={<span className="muted text-xs">all containers, combined</span>} />
              <CardBody><TimeSeriesChart timestamps={timestamps} series={netSeries} formatValue={formatBytesPerSec} /></CardBody>
            </Card>
            <Card>
              <CardHeader title="Storage capacity" action={<span className="muted text-xs">/opt/cast/data (bind-mounted host disk)</span>} />
              <CardBody>
                <div className="col gap-2">
                  <Gauge percent={latest.storagePercent} />
                  <span className="muted text-sm">{formatBytes(latest.storageUsedBytes)} used of {formatBytes(latest.storageTotalBytes)} ({pct(latest.storagePercent)})</span>
                </div>
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

interface IntegrationSample {
  at: string;
  cw: { latencyMs: number; ok: boolean } | null;
  aisTier1: { avgProcessingMs: number; maxProcessingMs: number } | null;
  aisTier2: { avgProcessingMs: number; maxProcessingMs: number } | null;
}
interface IntegrationMetricsResponse { samples: IntegrationSample[]; }

/**
 * ConnectWise response latency + AIS message-processing latency, over time.
 * Reuses calls the probes above already make every ~15s (the frontend's own
 * poll interval) — see components/api/src/health/integrationMetrics.ts for
 * why TrackingMore isn't here (no existing periodic call to piggyback on,
 * and it's metered — not worth a new poll loop just for this chart).
 */
function IntegrationPerformance({ metrics, err }: { metrics: IntegrationMetricsResponse | null; err: string | null }) {
  const [rangeMinutes, setRangeMinutes] = useState(60);

  if (err) return <Banner tone="danger">{err}</Banner>;
  if (!metrics) {
    return (
      <div className="row gap-2">
        <Spinner /> <span className="muted">Loading integration performance…</span>
      </div>
    );
  }

  // Samples land roughly every 15s (the frontend's own poll cadence, not a
  // fixed server interval), so this window is approximate — fine for a chart
  // whose x-axis is already labeled with real timestamps.
  const approxIntervalSeconds = 15;
  const sliceCount = Math.min(metrics.samples.length, Math.round((rangeMinutes * 60) / approxIntervalSeconds));
  const windowed = metrics.samples.slice(-sliceCount);

  if (windowed.length === 0) {
    return <EmptyState>Collecting samples — integration-performance charts populate as System Health is polled.</EmptyState>;
  }

  const timestamps = windowed.map((s) => s.at);
  const series1 = "var(--chart-series-1)";
  const series2 = "var(--chart-series-2)";
  const ms = (v: number) => `${v.toFixed(1)} ms`;

  const cwSeries: ChartSeries[] = [
    { key: "cw", label: "ConnectWise", color: series1, values: windowed.map((s) => (s.cw ? s.cw.latencyMs : null)) },
  ];
  const aisSeries: ChartSeries[] = [
    { key: "tier1", label: "Tier 1", color: series1, values: windowed.map((s) => (s.aisTier1 ? s.aisTier1.avgProcessingMs : null)) },
    { key: "tier2", label: "Tier 2", color: series2, values: windowed.map((s) => (s.aisTier2 ? s.aisTier2.avgProcessingMs : null)) },
  ];

  return (
    <div className="col gap-4">
      <div className="row gap-2">
        <span className="muted text-sm">Range</span>
        {RANGE_OPTIONS.map((o) => (
          <Button key={o.label} size="sm" variant={rangeMinutes === o.minutes ? "primary" : "secondary"} onClick={() => setRangeMinutes(o.minutes)}>
            {o.label}
          </Button>
        ))}
      </div>
      <div className="card-grid card-grid-pair">
        <Card>
          <CardHeader title="ConnectWise response latency" action={<span className="muted text-xs">SystemInfo ping</span>} />
          <CardBody><TimeSeriesChart timestamps={timestamps} series={cwSeries} formatValue={ms} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="AIS message-processing latency" action={<span className="muted text-xs">avg per message</span>} />
          <CardBody><TimeSeriesChart timestamps={timestamps} series={aisSeries} formatValue={ms} /></CardBody>
        </Card>
      </div>
    </div>
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
            {loading ? "Checking…" : "Refresh"}
          </Button>
        }
      />
      {loading && !pkgs ? (
        <div className="card-body row gap-2">
          <Spinner /> <span className="muted">Scanning OSV.dev…</span>
        </div>
      ) : err ? (
        <CardBody><Banner tone="danger">{err}</Banner></CardBody>
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

interface ContainerInfo {
  name: string;
  service: string;
  purpose: string;
  image: string;
  state: string;
  health: "healthy" | "unhealthy" | "starting" | "none";
  status: string;
  createdAt: string;
  ports: string[];
}

function containerTone(c: ContainerInfo): "success" | "warning" | "danger" {
  if (c.health === "unhealthy") return "danger";
  if (c.health === "starting" || c.state === "restarting") return "warning";
  if (c.state === "running") return "success";
  return "danger";
}

function ContainersCard({ containerMetrics }: { containerMetrics: ContainerMetric[] | null }) {
  const [containers, setContainers] = useState<ContainerInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setErr(null);
    api
      .get<{ containers: ContainerInfo[] }>("/health/containers")
      .then((r) => {
        setContainers(r.containers);
        setCheckedAt(new Date().toISOString());
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Container query failed"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const down = containers?.filter((c) => containerTone(c) === "danger").length ?? 0;
  const warn = containers?.filter((c) => containerTone(c) === "warning").length ?? 0;
  const summaryTone = down ? "danger" : warn ? "warning" : "success";
  const summaryText = down ? `${down} not running` : warn ? `${warn} starting/restarting` : "all running";

  const metricFor = (name: string) => containerMetrics?.find((m) => m.name === name) ?? null;

  return (
    <Card>
      <CardHeader
        title={
          <span className="row gap-2">
            Docker Containers
            {containers && <Badge tone={summaryTone}>{summaryText}</Badge>}
          </span>
        }
        action={
          <div className="row gap-2">
            {checkedAt && <span className="muted text-xs">checked {ago(checkedAt)}</span>}
            <Button size="sm" variant="secondary" onClick={load} disabled={loading}>
              {loading ? "Checking…" : "Refresh"}
            </Button>
          </div>
        }
      />
      {loading && !containers ? (
        <div className="card-body row gap-2">
          <Spinner /> <span className="muted">Querying Docker…</span>
        </div>
      ) : err ? (
        <CardBody><Banner tone="danger">{err}</Banner></CardBody>
      ) : containers!.length === 0 ? (
        <EmptyState>No containers found.</EmptyState>
      ) : (
        <Table className="align-top table-dense">
          <thead>
            <tr>
              <th>Container</th>
              <th>Image</th>
              <th>Status</th>
              <th>CPU</th>
              <th>Memory</th>
              <th>Disk I/O</th>
              <th>Created</th>
              <th>Ports</th>
            </tr>
          </thead>
          <tbody>
            {containers!.map((c) => {
              const detail = c.status.replace(/\s*\((healthy|unhealthy|starting)\)\s*$/i, "");
              const m = metricFor(c.name);
              return (
                <tr key={c.name}>
                  <td data-label="Container" className="td-stack">
                    <strong className="mono">{c.name}</strong>
                    <div className="muted text-sm">{c.purpose}</div>
                  </td>
                  <td data-label="Image" className="mono text-sm nowrap-cell">{c.image}</td>
                  <td data-label="Status" className="td-stack">
                    <Badge tone={containerTone(c)}>{c.health === "none" ? c.state : c.health}</Badge>
                    {detail !== c.state && <span className="muted text-xs">{detail}</span>}
                  </td>
                  <td data-label="CPU" className="td-stack">
                    {m ? <><Gauge percent={m.cpuPercent} /><span className="muted text-xs">{m.cpuPercent.toFixed(1)}%</span></> : <span className="muted text-sm">—</span>}
                  </td>
                  <td data-label="Memory" className="td-stack">
                    {m ? <><Gauge percent={m.memPercent} /><span className="muted text-xs">{formatBytes(m.memUsedBytes)}</span></> : <span className="muted text-sm">—</span>}
                  </td>
                  <td data-label="Disk I/O" className="mono text-sm nowrap-cell">
                    {m ? `${formatBytesPerSec(m.blockReadBytesPerSec)} ↓ · ${formatBytesPerSec(m.blockWriteBytesPerSec)} ↑` : "—"}
                  </td>
                  <td data-label="Created" className="text-sm">{ago(c.createdAt)}</td>
                  <td data-label="Ports" className="mono text-sm">{c.ports.length ? c.ports.join(", ") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export function SystemHealth() {
  const [h, setH] = useState<FullHealth | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [metricsErr, setMetricsErr] = useState<string | null>(null);
  const [integrationMetrics, setIntegrationMetrics] = useState<IntegrationMetricsResponse | null>(null);
  const [integrationMetricsErr, setIntegrationMetricsErr] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    api.get<FullHealth>("/health/full").then(setH).catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"));
  };
  const loadMetrics = () => {
    api.get<MetricsResponse>("/health/metrics").then(setMetrics).catch((e) => setMetricsErr(e instanceof Error ? e.message : "Failed to load metrics"));
  };
  const loadIntegrationMetrics = () => {
    api
      .get<IntegrationMetricsResponse>("/health/integration-metrics")
      .then(setIntegrationMetrics)
      .catch((e) => setIntegrationMetricsErr(e instanceof Error ? e.message : "Failed to load integration metrics"));
  };
  useEffect(() => {
    load();
    loadMetrics();
    loadIntegrationMetrics();
    const t = setInterval(() => {
      load();
      loadMetrics();
      loadIntegrationMetrics();
    }, 15000);
    return () => clearInterval(t);
  }, []);

  const latestContainers = metrics?.samples.length ? metrics.samples[metrics.samples.length - 1].containers : null;

  return (
    <div className="col gap-4">
      <PageHeader
        title="System Health"
        subtitle="Live status, resource usage, and dependencies for CAST's own services."
        actions={<Button variant="secondary" onClick={() => { load(); loadMetrics(); loadIntegrationMetrics(); }}>Refresh status</Button>}
      />
      {err ? (
        <Banner tone="danger">{err}</Banner>
      ) : !h ? (
        <div className="row gap-2">
          <Spinner /> <span className="muted">Loading…</span>
        </div>
      ) : (
        <>
          <ResourceUsage metrics={metrics} err={metricsErr} />

          <div className="card-grid card-grid-compact">
            <ProbeCard title="ConnectWise API" probe={h.integrations.connectwise} />
            <ProbeCard title="aisstream (AIS feed)" probe={h.integrations.aisstream} />
            <ProbeCard title="AIS Tier 1 (real-time)" probe={h.integrations.aisTier1} />
            <ProbeCard title="AIS Tier 2 (rotating)" probe={h.integrations.aisTier2} />
            <ProbeCard title="Process backpressure" probe={h.backpressure} />
            <ProbeCard title="Active Directory" probe={h.integrations.activeDirectory} />
            <ProbeCard title="TLS certificate" probe={h.infra.tls} />
            <ProbeCard title="Backups" probe={h.infra.backups} />
          </div>

          <IntegrationPerformance metrics={integrationMetrics} err={integrationMetricsErr} />

          <Card>
            <CardHeader title="Application" />
            <CardBody>
              <div className="kv"><span className="kv-key">Version</span><span className="kv-val mono">{h.app.version}</span></div>
              <div className="kv"><span className="kv-key">Build</span><span className="kv-val mono">{h.app.build}</span></div>
              <div className="kv"><span className="kv-key">Environment</span><span className="kv-val">{h.app.env}</span></div>
              <div className="kv"><span className="kv-key">API process uptime</span><span className="kv-val mono">{formatDuration(h.app.uptimeSeconds)}</span></div>
              <div className="kv"><span className="kv-key">Database size</span><span className="kv-val mono">{formatBytes(h.app.dbSizeBytes)}</span></div>
              <div className="kv">
                <span className="kv-key">ConnectWise writes</span>
                <span className="kv-val row gap-2">
                  {h.cwWrites ? <Badge tone="danger">ENABLED</Badge> : <Badge tone="success">disabled (safe)</Badge>}
                  <Link to="/integrations" className="text-sm">Manage →</Link>
                </span>
              </div>
            </CardBody>
          </Card>
          <ContainersCard containerMetrics={latestContainers} />
          <PackagesCard />
        </>
      )}
    </div>
  );
}
