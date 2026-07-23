import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, CardBody, Tabs, Table, Badge, Banner, Spinner, EmptyState } from "../ui";
import type { TabDef } from "../ui";

// Tabs mirror the extension's design record (mockup §1).
const tabs: TabDef[] = [
  { id: "roles", label: "Role Rules" },
  { id: "pods", label: "Expected Pods" },
  { id: "fleet", label: "Fleet" },
  { id: "deploy", label: "Deployment" },
];

export function Extension() {
  const [active, setActive] = useState("roles");
  const label = tabs.find((t) => t.id === active)?.label ?? "";

  return (
    <div>
      <Tabs tabs={tabs} active={active} onChange={setActive} />
      {active === "fleet" ? <FleetCatalog /> : active === "deploy" ? <DeploymentPanel /> : <Placeholder label={label} />}
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <Card>
      <CardBody>
        <div className="col gap-2">
          <h3>{label}</h3>
          <p className="muted">
            Scaffold placeholder. Built against the approved mockup and{" "}
            <span className="mono">@cast/config-schema</span> via <span className="mono">GET/PUT /api/config</span>.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

function DeploymentPanel() {
  return (
    <div className="col gap-4">
      <Banner tone="info">
        Install CAST in your browser: download the installer, run it as administrator, then restart Chrome/Edge — the
        extension installs automatically.
      </Banner>
      <Card>
        <CardBody>
          <div className="col gap-3">
            <h3>Install the CAST extension</h3>
            <ol className="muted">
              <li>Download the installer.</li>
              <li><strong>Double-click it</strong>, then click <strong>Yes</strong> when Windows asks.</li>
              <li>Restart Chrome/Edge — CAST installs automatically.</li>
            </ol>
            <div className="row gap-2 wrap">
              <a className="btn btn-primary" href="/api/extension/install.bat" download>
                Download installer
              </a>
              <a className="btn btn-secondary" href="/api/extension/install.ps1" download>.ps1</a>
              <a className="btn btn-secondary" href="/api/extension/install.reg" download>.reg</a>
            </div>
            <p className="muted text-sm">
              Requires an enterprise-managed (AD-joined) device, and the extension update host to be live (INIT-0001).
              Mass deployment (GPO/Intune) is a later step — scripts live in <span className="mono">components/browser-extension/deploy</span>.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

interface Instance {
  deviceId: string;
  browser: string;
  osUser: string;
  cwMemberId: string;
  extensionVersion: string;
  rulesVersion: string;
  lastCheckIn: string;
}
interface Catalog {
  catalog: { member: { identifier: string; name: string }; instances: Instance[] }[];
  orphans: Instance[];
  membersError: string | null;
  totalInstances: number;
  membersWithInstances: number;
  totalMembers: number;
}

function ago(iso: string): string {
  if (!iso) return "—";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function FleetCatalog() {
  const [data, setData] = useState<Catalog | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    api.get<Catalog>("/checkins").then(setData).catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"));
  };
  useEffect(load, []);

  if (err) return <Banner tone="danger">{err}</Banner>;
  if (!data)
    return (
      <div className="row gap-2">
        <Spinner /> <span className="muted">Loading…</span>
      </div>
    );

  const rows = [
    ...data.catalog.flatMap((g) => g.instances.map((i) => ({ user: g.member.name, memberId: g.member.identifier, ...i }))),
    ...data.orphans.map((i) => ({ user: i.cwMemberId || "(unknown)", memberId: i.cwMemberId, ...i })),
  ];

  return (
    <div className="col gap-4">
      <div className="row gap-2 wrap">
        <Badge tone="neutral">{data.totalInstances} instances</Badge>
        {data.totalMembers > 0 && (
          <Badge tone="brand">
            {data.membersWithInstances}/{data.totalMembers} members checked in
          </Badge>
        )}
      </div>
      {data.membersError && (
        <Banner tone="warning">
          CW member list unavailable ({data.membersError}) — showing check-ins by reported member id. The app_CAST role
          may need System → Members read.
        </Banner>
      )}
      <Card>
        {rows.length === 0 ? (
          <EmptyState>No extension check-ins yet. Instances appear here as the extension phones home.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>User</th>
                <th>Device</th>
                <th>Browser</th>
                <th>Ext version</th>
                <th>Rules version</th>
                <th>Last sync</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.deviceId + i}>
                  <td data-label="User">
                    <strong>{r.user}</strong>
                    {r.memberId && <span className="muted text-sm"> ({r.memberId})</span>}
                  </td>
                  <td data-label="Device" className="mono">{r.deviceId}</td>
                  <td data-label="Browser" className="muted">{r.browser || "—"}</td>
                  <td data-label="Ext version" className="mono">{r.extensionVersion || "—"}</td>
                  <td data-label="Rules version" className="mono">{r.rulesVersion || "—"}</td>
                  <td data-label="Last sync" className="muted">{ago(r.lastCheckIn)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
