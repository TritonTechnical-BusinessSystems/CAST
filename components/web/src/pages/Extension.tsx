import { useEffect, useState } from "react";
import { api } from "../api";
import { Button, Card, CardBody, Tabs, Table, Badge, Banner, Spinner, EmptyState, Select, Modal, IconX } from "../ui";
import type { TabDef } from "../ui";
import { useTabParam } from "../useTabParam";

// Tabs mirror the extension's design record (mockup §1). "Deployment" is the
// per-member deployment catalog; "Install" is the installer download.
const tabs: TabDef[] = [
  { id: "roles", label: "Role Rules" },
  { id: "pods", label: "Expected Pods" },
  { id: "deployment", label: "Deployment" },
  { id: "install", label: "Install" },
];

export function Extension() {
  const [active, setActive] = useTabParam(
    tabs.map((t) => t.id),
    "roles",
  );
  const label = tabs.find((t) => t.id === active)?.label ?? "";

  return (
    <div>
      <Tabs tabs={tabs} active={active} onChange={setActive} />
      {active === "deployment" ? (
        <DeploymentCatalog />
      ) : active === "install" ? (
        <InstallPanel />
      ) : (
        <Placeholder label={label} />
      )}
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

function InstallPanel() {
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

interface Device {
  deviceId: string;
  deviceName: string;
  browser: string;
  osUser: string;
  cwMemberId: string;
  extensionVersion: string;
  rulesVersion: string;
  lastCheckIn: string;
}
interface FleetMember {
  identifier: string;
  name: string;
  devices: Device[];
  lastCheckIn: string | null;
}
interface FleetData {
  members: FleetMember[];
  orphans: Device[];
  membersError: string | null;
  totalMembers: number;
  totalDevices: number;
}

type FilterMode = "all" | "current" | "attention";
type Status = "current" | "stale" | "missing";

function ago(iso: string | null): string {
  if (!iso) return "—";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// A member is "current" if any device synced within the threshold; "missing" if
// no device has ever checked in; otherwise "stale" (installed but out of date).
function statusOf(m: FleetMember, days: number): Status {
  if (!m.lastCheckIn || m.devices.length === 0) return "missing";
  const ageDays = (Date.now() - new Date(m.lastCheckIn).getTime()) / 86_400_000;
  return ageDays <= days ? "current" : "stale";
}

const STATUS_BADGE: Record<Status, { tone: "success" | "warning" | "neutral"; label: string }> = {
  current: { tone: "success", label: "Current" },
  stale: { tone: "warning", label: "Out of date" },
  missing: { tone: "neutral", label: "Not installed" },
};

const THRESHOLDS = [7, 14, 30, 60, 90];

function DeploymentCatalog() {
  const [data, setData] = useState<FleetData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<FilterMode>("all");
  const [days, setDays] = useState(30);
  const [pendingRemove, setPendingRemove] = useState<{ user: string; device: Device } | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = () => {
    setErr(null);
    api.get<FleetData>("/checkins").then(setData).catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"));
  };
  useEffect(load, []);

  const confirmRemove = async () => {
    if (!pendingRemove) return;
    setRemoving(true);
    try {
      await api.del(`/checkins/${encodeURIComponent(pendingRemove.device.deviceId)}`);
      setPendingRemove(null);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setRemoving(false);
    }
  };

  if (err) return <Banner tone="danger">{err}</Banner>;
  if (!data)
    return (
      <div className="row gap-2">
        <Spinner /> <span className="muted">Loading…</span>
      </div>
    );

  const withStatus = data.members.map((m) => ({ member: m, status: statusOf(m, days) }));
  const counts = {
    all: withStatus.length,
    current: withStatus.filter((r) => r.status === "current").length,
    attention: withStatus.filter((r) => r.status !== "current").length,
  };
  const visible = withStatus
    .filter((r) => (mode === "all" ? true : mode === "current" ? r.status === "current" : r.status !== "current"))
    .sort((a, b) => a.member.name.localeCompare(b.member.name));

  const FILTERS: { id: FilterMode; label: string }[] = [
    { id: "all", label: `All users (${counts.all})` },
    { id: "current", label: `Current (${counts.current})` },
    { id: "attention", label: `Needs attention (${counts.attention})` },
  ];

  return (
    <div className="col gap-4">
      <div className="row between wrap gap-3">
        <div className="row gap-2 wrap">
          {FILTERS.map((f) => (
            <Button key={f.id} variant={mode === f.id ? "primary" : "secondary"} onClick={() => setMode(f.id)}>
              {f.label}
            </Button>
          ))}
        </div>
        <label className="row gap-2 text-sm soft">
          Out of date after
          <Select className="w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {THRESHOLDS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </Select>
        </label>
      </div>

      {data.membersError && (
        <Banner tone="warning">
          CW member list unavailable ({data.membersError}) — showing only members that have checked in, grouped by
          reported id. Members with no install can't be listed until the app_CAST role has System → Members read.
        </Banner>
      )}

      <Card>
        {visible.length === 0 ? (
          <EmptyState>
            {mode === "all"
              ? "No active CW members found yet."
              : mode === "current"
                ? "No members have a current deployment in this window."
                : "Every member's deployment is current — nothing needs attention."}
          </EmptyState>
        ) : (
          <Table className="align-top">
            <thead>
              <tr>
                <th>User</th>
                <th>Devices &amp; browsers</th>
                <th>Status</th>
                <th>Latest sync</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ member, status }) => {
                const badge = STATUS_BADGE[status];
                return (
                  <tr key={member.identifier}>
                    <td data-label="User">
                      <strong>{member.name}</strong>
                      <span className="muted text-sm"> ({member.identifier})</span>
                    </td>
                    <td data-label="Devices &amp; browsers" className="td-stack">
                      {member.devices.length === 0 ? (
                        <span className="muted">Not registered</span>
                      ) : (
                        <div className="col gap-1">
                          {member.devices.map((d) => (
                            <div key={d.deviceId} className="row between gap-2 text-sm">
                              <span className="row gap-2">
                                <strong>{d.deviceName || d.deviceId}</strong>
                                <span className="muted">{d.browser || "Browser"}</span>
                              </span>
                              <button
                                className="icon-btn"
                                title="Remove this device/browser record"
                                aria-label="Remove this device/browser record"
                                onClick={() => setPendingRemove({ user: member.name, device: d })}
                              >
                                <IconX />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td data-label="Status">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </td>
                    <td data-label="Last sync" className="muted">
                      {ago(member.lastCheckIn)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {data.orphans.length > 0 && (
        <Card>
          <CardBody>
            <div className="col gap-2">
              <h3>Unrecognized check-ins ({data.orphans.length})</h3>
              <p className="muted text-sm">
                These devices reported a CW member id that doesn't match any active member — a departed user, a typo, or
                a stale device. Review and clear as needed.
              </p>
              <div className="col gap-1">
                {data.orphans.map((d) => (
                  <div key={d.deviceId} className="row gap-2 text-sm wrap">
                    <strong>{d.cwMemberId || "(unknown)"}</strong>
                    <span>{d.browser || "Browser"}</span>
                    <span className="mono muted">{d.deviceId}</span>
                    <span className="muted">· {ago(d.lastCheckIn)}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {pendingRemove && (
        <Modal
          title="Remove this record?"
          onClose={() => !removing && setPendingRemove(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPendingRemove(null)} disabled={removing}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmRemove} disabled={removing}>
                {removing ? "Removing…" : "Remove record"}
              </Button>
            </>
          }
        >
          <p>
            Remove the check-in record for{" "}
            <strong>{pendingRemove.device.deviceName || pendingRemove.device.deviceId}</strong>
            {pendingRemove.device.browser ? ` · ${pendingRemove.device.browser}` : ""} under{" "}
            <strong>{pendingRemove.user}</strong>?
          </p>
          <p className="muted text-sm">
            This only prunes the record from CAST — it does <strong>not</strong> uninstall the extension. If that browser
            is still installed and checks in again, the record reappears.
          </p>
        </Modal>
      )}
    </div>
  );
}
