import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, Table, Badge, Banner, Spinner, EmptyState } from "../ui";

interface Vessel {
  company: string;
  imo: string;
  vessel: string;
  status: "underway" | "moored" | "anchored" | "dry-docked" | "docked";
  position: string;
  target: string;
  lastSynced: string;
}

const statusLabel: Record<Vessel["status"], string> = {
  underway: "Underway",
  moored: "Moored",
  anchored: "Anchored",
  "dry-docked": "Dry Docked",
  docked: "Docked",
};

const statusTone: Record<Vessel["status"], "info" | "neutral" | "warning" | "success"> = {
  underway: "info",
  moored: "neutral",
  anchored: "warning",
  "dry-docked": "warning",
  docked: "success",
};

export function Vessel() {
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ vessels: Vessel[] }>("/vessels")
      .then((r) => setVessels(r.vessels))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load vessels"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="col gap-4">
      <Banner tone="info">
        Scaffold — data source, eligible CW status, and target-location rules are open (INIT-0012). Vessels below are
        illustrative, served by <span className="mono">GET /api/vessels</span>.
      </Banner>

      <Card>
        {loading ? (
          <div className="card-body row gap-2">
            <Spinner /> <span className="muted">Loading…</span>
          </div>
        ) : error ? (
          <EmptyState>{error}</EmptyState>
        ) : vessels.length === 0 ? (
          <EmptyState>No vessels.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Company</th>
                <th>IMO number</th>
                <th>Vessel</th>
                <th>Navigational status</th>
                <th>Current position</th>
                <th>Target location</th>
                <th>Last synced</th>
              </tr>
            </thead>
            <tbody>
              {vessels.map((v) => (
                <tr key={v.imo}>
                  <td>
                    <strong>{v.company}</strong>
                  </td>
                  <td className="mono">{v.imo}</td>
                  <td>{v.vessel}</td>
                  <td>
                    <Badge tone={statusTone[v.status]}>{statusLabel[v.status]}</Badge>
                  </td>
                  <td className="muted">{v.position}</td>
                  <td>{v.target}</td>
                  <td className="muted mono">{v.lastSynced}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
