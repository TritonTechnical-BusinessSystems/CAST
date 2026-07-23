import { useEffect, useState } from "react";
import { api } from "../api";

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
    <div>
      <div className="banner card">
        This is a scaffold — data source, eligible CW status, and target-location rules are
        still open decisions (<strong>INIT-0012</strong>). Vessels below are illustrative,
        served by <code>GET /api/vessels</code>.
      </div>

      <div className="card table-wrap">
        {loading ? (
          <p className="muted pad">Loading…</p>
        ) : error ? (
          <p className="muted pad">{error}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Company</th><th>IMO number</th><th>Vessel</th>
                <th>Navigational status</th><th>Current position</th><th>Target location</th><th>Last synced</th>
              </tr>
            </thead>
            <tbody>
              {vessels.map((v) => (
                <tr key={v.imo}>
                  <td><strong>{v.company}</strong></td>
                  <td className="mono">{v.imo}</td>
                  <td>{v.vessel}</td>
                  <td><span className={`pill status-${v.status}`}>{statusLabel[v.status]}</span></td>
                  <td className="muted">{v.position}</td>
                  <td>{v.target}</td>
                  <td className="muted mono">{v.lastSynced}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <style>{css}</style>
    </div>
  );
}

const css = `
  .banner { padding: 12px 16px; margin-bottom: 16px; font-size: 0.8125rem; background: var(--color-signal-wash); border-color: color-mix(in srgb, var(--color-signal) 40%, transparent); }
  .banner code { font-family: var(--font-mono); font-size: 0.75rem; }
  .table-wrap { overflow-x: auto; }
  .pad { padding: 24px; }
  .muted { color: var(--color-ink-faint); }
  table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
  thead th { text-align: left; font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-ink-faint); padding: 8px 12px; border-bottom: 1px solid var(--color-border); white-space: nowrap; }
  tbody td { padding: 12px; border-bottom: 1px solid var(--color-border); }
  tbody tr:last-child td { border-bottom: none; }
  .pill { display: inline-block; font-size: 0.6875rem; font-weight: 700; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
  .status-underway { background: var(--color-signal-wash); color: var(--color-signal); }
  .status-moored { background: rgba(107,114,128,0.16); color: var(--color-ink-soft); }
  .status-anchored { background: rgba(166,105,10,0.14); color: var(--color-warning); }
  .status-dry-docked { background: rgba(156,80,36,0.14); color: #9c5024; }
  .status-docked { background: rgba(31,138,91,0.14); color: var(--color-success); }
`;
