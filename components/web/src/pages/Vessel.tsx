import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader, Card, Table, Badge, Banner, Spinner, EmptyState, Disclosure, Select, Field, Checkbox, Button, Modal, useToast } from "../ui";

type WriteAllowlist = "all" | string[];

interface TrackedVessel {
  id: string;
  vesselName: string;
  companyName: string;
  mmsi: string;
  tier: 1 | 2;
  navigationalStatus: "docked" | "anchored" | "underway" | "aground" | "unknown";
  summary: string | null;
  addressLine1: string | null;
  lastSeenAt: string | null;
  destination: string | null;
  etaIso: string | null;
}

interface HistoryEntry {
  id: number;
  kind: "position" | "voyage";
  lat: number | null;
  lon: number | null;
  sog: number | null;
  cog: number | null;
  navStatusCode: number | null;
  destination: string | null;
  etaIso: string | null;
  recordedAt: string;
}

const STATUS_LABEL: Record<TrackedVessel["navigationalStatus"], string> = {
  docked: "Docked",
  anchored: "Anchored",
  underway: "Underway",
  aground: "Aground",
  unknown: "No signal yet",
};

const STATUS_TONE: Record<TrackedVessel["navigationalStatus"], "success" | "neutral" | "info" | "danger"> = {
  docked: "success",
  anchored: "neutral",
  underway: "info",
  aground: "danger",
  unknown: "neutral",
};

const HISTORY_LIMIT_OPTIONS = [10, 20, 50, 100];

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

function HistoryPanel({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) {
    return <EmptyState>No updates received yet.</EmptyState>;
  }
  return (
    <Table>
      <thead>
        <tr>
          <th>Received</th>
          <th>Type</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id}>
            <td data-label="Received" className="mono muted">{formatTimestamp(e.recordedAt)}</td>
            <td data-label="Type">
              <Badge tone={e.kind === "position" ? "info" : "brand"}>{e.kind === "position" ? "Position" : "Voyage"}</Badge>
            </td>
            <td data-label="Detail" className="muted">
              {e.kind === "position"
                ? `${e.lat?.toFixed(5)}, ${e.lon?.toFixed(5)} (nav code ${e.navStatusCode ?? "—"}${e.sog != null ? `, ${e.sog.toFixed(1)} kn` : ""})`
                : `Destination: ${e.destination || "—"}${e.etaIso ? ` · ETA ${formatTimestamp(e.etaIso)}` : ""}`}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function Vessel() {
  const toast = useToast();
  const [vessels, setVessels] = useState<TrackedVessel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [historyCache, setHistoryCache] = useState<Record<string, HistoryEntry[] | "loading" | "error">>({});
  const [cwWritesEnabled, setCwWritesEnabled] = useState(false);
  const [allowlist, setAllowlist] = useState<WriteAllowlist>([]);
  // Neither "writes are off" nor an empty allowlist can be trusted until
  // BOTH status fetches actually succeed — silently falling back to those
  // (safe-looking) defaults on a failed request would let this page show
  // "OFF" while the server might genuinely be writing live. Security review,
  // 2026-08-18: "the operator's only visibility surface silently and
  // confidently reports the safest possible state when it actually knows
  // nothing."
  const [writeStatusError, setWriteStatusError] = useState(false);
  const [confirmAllMode, setConfirmAllMode] = useState(false);

  function loadWriteStatus() {
    setWriteStatusError(false);
    Promise.all([
      // Vessel tracking is Production-only (see config.ts's
      // VESSEL_SITE_WRITE_ALLOWLIST_KEY comment / routes/tracking.ts's
      // CW_INSTANCE), so this page's write status always means Production's.
      api.get<{ writesEnabled: boolean }>("/integrations/tritontech/connectwise"),
      api.get<{ allowlist: WriteAllowlist }>("/tracking/vessel-site-write-allowlist"),
    ])
      .then(([cw, gate]) => {
        setCwWritesEnabled(cw.writesEnabled);
        setAllowlist(gate.allowlist);
      })
      .catch(() => setWriteStatusError(true));
  }

  useEffect(() => {
    api
      .get<{ vessels: TrackedVessel[] }>("/vessels/tracked")
      .then((r) => setVessels(r.vessels))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load tracked vessels"))
      .finally(() => setLoading(false));
    loadWriteStatus();
  }, []);

  function isWriteAllowed(mmsi: string): boolean {
    return allowlist === "all" || allowlist.includes(mmsi);
  }

  function saveAllowlist(next: WriteAllowlist) {
    const prev = allowlist;
    setAllowlist(next);
    api
      .put<{ ok: boolean; allowlist: WriteAllowlist }>("/tracking/vessel-site-write-allowlist", { allowlist: next })
      .catch((e) => {
        setAllowlist(prev);
        toast("error", e instanceof Error ? e.message : "Failed to update the write allowlist");
      });
  }

  function toggleVessel(mmsi: string) {
    if (allowlist === "all") return;
    const next = allowlist.includes(mmsi) ? allowlist.filter((m) => m !== mmsi) : [...allowlist, mmsi];
    saveAllowlist(next);
  }

  function loadHistory(mmsi: string) {
    const key = `${mmsi}:${historyLimit}`;
    if (historyCache[key]) return;
    setHistoryCache((c) => ({ ...c, [key]: "loading" }));
    api
      .get<{ history: HistoryEntry[] }>(`/vessels/history/${mmsi}?limit=${historyLimit}`)
      .then((r) => setHistoryCache((c) => ({ ...c, [key]: r.history })))
      .catch(() => setHistoryCache((c) => ({ ...c, [key]: "error" })));
  }

  return (
    <div className="col gap-4">
      <PageHeader
        embedded
        title="Vessel Location"
        subtitle="Every vessel with live AIS coverage right now (Monitoring Tier 1/2), its current position, and its most recently received updates."
        actions={
          <>
            <Field label="Vessel Site writes">
              <Select
                value={allowlist === "all" ? "all" : "list"}
                disabled={writeStatusError}
                onChange={(e) => {
                  if (e.target.value === "all") {
                    setConfirmAllMode(true);
                  } else {
                    saveAllowlist([]);
                  }
                }}
              >
                <option value="list">Allowlist only (test a few)</option>
                <option value="all">All tracked vessels</option>
              </Select>
            </Field>
            <Field label="History per vessel">
              <Select value={historyLimit} onChange={(e) => setHistoryLimit(Number(e.target.value))}>
                {HISTORY_LIMIT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    Last {n}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        }
      />
      <Banner
        tone={
          writeStatusError
            ? "danger"
            : !cwWritesEnabled
              ? "info"
              : allowlist === "all"
                ? "danger"
                : allowlist.length > 0
                  ? "warning"
                  : "info"
        }
      >
        {writeStatusError ? (
          <>
            ⚠️ Couldn't confirm write status from the server — treat this page as unknown, not safe, until it
            reloads.{" "}
            <button type="button" className="btn btn-ghost btn-sm" onClick={loadWriteStatus}>
              Retry
            </button>
          </>
        ) : !cwWritesEnabled ? (
          <>
            ConnectWise writes are OFF — this page is preview-only right now (<span className="mono">formatSiteUpdate</span>).
          </>
        ) : allowlist === "all" ? (
          <>
            ⚠️ ConnectWise writes are LIVE for <strong>every</strong> vessel shown below — the "Vessel Site writes"
            selector above is set to "All tracked vessels".
          </>
        ) : allowlist.length > 0 ? (
          <>
            ⚠️ ConnectWise writes are LIVE for <strong>{allowlist.length}</strong> vessel{allowlist.length === 1 ? "" : "s"} — check the
            box on a vessel below to add or remove it from the allowlist.
          </>
        ) : (
          <>
            ConnectWise writes are enabled, but no vessel is on the write allowlist yet — this page is still
            preview-only until you check a box below.
          </>
        )}
      </Banner>
      {confirmAllMode && (
        <Modal
          title="Enable ConnectWise writes for ALL tracked vessels?"
          onClose={() => setConfirmAllMode(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmAllMode(false)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  saveAllowlist("all");
                  setConfirmAllMode(false);
                }}
              >
                Enable for all vessels
              </Button>
            </>
          }
        >
          <div className="col gap-3">
            <p>
              Every vessel with live AIS coverage (Tier 1/2 — up to ~60 at a time) will start receiving real
              ConnectWise Vessel Site writes on the next tier-refresh cycle, not just the ones currently checked
              below.
            </p>
            <p className="muted text-sm">You can switch back to the allowlist at any time — it resets to empty, not to whatever was previously checked.</p>
          </div>
        </Modal>
      )}

      {loading ? (
        <Card>
          <div className="card-body row gap-2">
            <Spinner /> <span className="muted">Loading…</span>
          </div>
        </Card>
      ) : error ? (
        <Card>
          <EmptyState>{error}</EmptyState>
        </Card>
      ) : vessels.length === 0 ? (
        <Card>
          <EmptyState>No vessels currently have AIS coverage (Monitoring Tier 1/2 is empty).</EmptyState>
        </Card>
      ) : (
        <div className="col gap-2">
          {vessels.map((v) => {
            const key = `${v.mmsi}:${historyLimit}`;
            const history = historyCache[key];
            return (
              <Disclosure
                key={v.id}
                onToggle={(open) => open && loadHistory(v.mmsi)}
                header={
                  <div className="row gap-3">
                    <strong>{v.vesselName}</strong>
                    <Badge tone="brand">Tier {v.tier}</Badge>
                    <Badge tone={STATUS_TONE[v.navigationalStatus]}>{STATUS_LABEL[v.navigationalStatus]}</Badge>
                    {cwWritesEnabled && isWriteAllowed(v.mmsi) && <Badge tone="danger">CW write: ON</Badge>}
                  </div>
                }
                subheader={
                  <div className="col gap-2">
                    <Checkbox
                      label="Enable ConnectWise write for this vessel"
                      checked={isWriteAllowed(v.mmsi)}
                      disabled={allowlist === "all" || writeStatusError}
                      onChange={() => toggleVessel(v.mmsi)}
                    />
                    <div>
                      <span className="muted">CW Site Name set to: </span>
                      {v.summary ?? "Vessel"}
                    </div>
                    <Table>
                      <thead>
                        <tr>
                          <th>Position</th>
                          <th>Destination</th>
                          <th>ETA</th>
                          <th>Last confirmed</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td data-label="Position" className="mono muted">{v.addressLine1 ?? "—"}</td>
                          <td data-label="Destination" className="muted">{v.destination ?? "—"}</td>
                          <td data-label="ETA" className="mono muted">{formatTimestamp(v.etaIso)}</td>
                          <td data-label="Last confirmed" className="mono muted">{formatTimestamp(v.lastSeenAt)}</td>
                        </tr>
                      </tbody>
                    </Table>
                  </div>
                }
              >
                {history === undefined || history === "loading" ? (
                  <div className="row gap-2">
                    <Spinner /> <span className="muted">Loading history…</span>
                  </div>
                ) : history === "error" ? (
                  <EmptyState>Failed to load history for MMSI {v.mmsi}.</EmptyState>
                ) : (
                  <HistoryPanel entries={history} />
                )}
              </Disclosure>
            );
          })}
        </div>
      )}
    </div>
  );
}
