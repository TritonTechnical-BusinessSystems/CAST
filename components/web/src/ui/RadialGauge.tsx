/**
 * Circular meter for a single ratio against a limit (dataviz skill's "Meter"
 * form) — CPU / memory / storage percent. Same threshold-coloring rule as the
 * linear `Gauge`: brand under 65%, warning 65–85%, danger at/above 85%. The
 * fill's stroke-dashoffset is genuinely runtime-dynamic data, so it's an
 * inline style per design-system.md rule 4 (same precedent as Gauge.tsx).
 */
const SIZE = 92;
const STROKE = 9;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function RadialGauge({ percent, value, label }: { percent: number; value: string; label: string }) {
  const p = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const color = p >= 85 ? "var(--color-danger)" : p >= 65 ? "var(--color-warning)" : "var(--color-brand)";
  const offset = CIRCUMFERENCE * (1 - p / 100);
  return (
    <div className="radial-gauge">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle className="radial-gauge-track" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} strokeWidth={STROKE} />
        <circle
          className="radial-gauge-fill"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{ stroke: color, strokeDasharray: CIRCUMFERENCE, strokeDashoffset: offset }}
        />
      </svg>
      <div className="radial-gauge-label">
        <span className="radial-gauge-value mono">{value}</span>
        <span className="radial-gauge-caption">{label}</span>
      </div>
    </div>
  );
}
