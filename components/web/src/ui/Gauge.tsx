/**
 * Horizontal gauge bar with threshold coloring (mirrors LC System Health):
 * brand under 65%, warning 65–85%, danger at/above 85%.
 */
export function Gauge({ percent }: { percent: number }) {
  const p = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const color = p >= 85 ? "var(--color-danger)" : p >= 65 ? "var(--color-warning)" : "var(--color-brand)";
  return (
    <div className="gauge">
      <div className="gauge-fill" style={{ width: `${p}%`, background: color }} />
    </div>
  );
}
