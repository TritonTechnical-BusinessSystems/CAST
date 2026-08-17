import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader, Card, Table, Badge, Banner, Spinner, EmptyState, Disclosure, Select, Field } from "../ui";

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
  const [vessels, setVessels] = useState<TrackedVessel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [historyCache, setHistoryCache] = useState<Record<string, HistoryEntry[] | "loading" | "error">>({});

  useEffect(() => {
    api
      .get<{ vessels: TrackedVessel[] }>("/vessels/tracked")
      .then((r) => setVessels(r.vessels))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load tracked vessels"))
      .finally(() => setLoading(false));
  }, []);

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
          <Field label="History per vessel">
            <Select value={historyLimit} onChange={(e) => setHistoryLimit(Number(e.target.value))}>
              {HISTORY_LIMIT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  Last {n}
                </option>
              ))}
            </Select>
          </Field>
        }
      />
      <Banner tone="info">
        "Current" reflects exactly what would be written to each vessel's ConnectWise Vessel Site if writes were
        enabled (<span className="mono">formatSiteUpdate</span>) — this page only reads that data, it never writes.
      </Banner>

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
                    <span className="muted">
                      {v.summary ?? "No signal received yet"}
                      {v.lastSeenAt ? ` · last seen ${formatTimestamp(v.lastSeenAt)}` : ""}
                    </span>
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
