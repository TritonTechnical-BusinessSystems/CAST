import { useMemo, useRef, useState } from "react";
import { Button } from "./Button";
import { Table } from "./Table";
import { EmptyState } from "./EmptyState";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
}

interface TimeSeriesChartProps {
  timestamps: string[];
  series: ChartSeries[];
  formatValue: (v: number) => string;
  formatAxisValue?: (v: number) => string;
  yMax?: number;
  height?: number;
}

const VBW = 600; // internal SVG coordinate space — scales to the card via CSS width:100%
const MARGIN = { top: 10, right: 14, bottom: 22, left: 44 };

function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const norm = max / magnitude;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * magnitude;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Thin 2px multi-line time-series chart (dataviz skill: crosshair + tooltip
 * hover, direct end-labels, legend for ≥2 series, table-view fallback so
 * every value stays reachable without hovering). No charting library — the
 * page has at most 2 series per chart, so hand-rolled SVG is proportionate.
 */
export function TimeSeriesChart({ timestamps, series, formatValue, formatAxisValue, yMax: fixedYMax, height = 180 }: TimeSeriesChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const n = timestamps.length;
  const plotW = VBW - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const axisFmt = formatAxisValue ?? formatValue;

  const yMax = useMemo(() => {
    if (fixedYMax !== undefined) return fixedYMax;
    const dataMax = Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
    return niceCeiling(dataMax);
  }, [series, fixedYMax]);

  const xAt = (i: number) => MARGIN.left + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => MARGIN.top + plotH - (Math.max(0, Math.min(yMax, v)) / yMax) * plotH;

  if (n === 0) {
    return <EmptyState>Collecting samples…</EmptyState>;
  }

  const paths = series.map((s) => {
    let d = "";
    let drawing = false;
    s.values.forEach((v, i) => {
      if (v === null) {
        drawing = false;
        return;
      }
      d += `${drawing ? "L" : "M"}${xAt(i).toFixed(2)},${yAt(v).toFixed(2)} `;
      drawing = true;
    });
    return { key: s.key, d };
  });

  // End-labels: nudge apart vertically if the two series finish close together.
  const endLabels = series
    .map((s) => {
      for (let i = s.values.length - 1; i >= 0; i--) {
        const v = s.values[i];
        if (v !== null) return { key: s.key, color: s.color, y: yAt(v), text: formatValue(v) };
      }
      return null;
    })
    .filter((e): e is { key: string; color: string; y: number; text: string } => e !== null);
  if (endLabels.length === 2 && Math.abs(endLabels[0].y - endLabels[1].y) < 14) {
    const mid = (endLabels[0].y + endLabels[1].y) / 2;
    const [a, b] = endLabels[0].y <= endLabels[1].y ? endLabels : [endLabels[1], endLabels[0]];
    a.y = mid - 7;
    b.y = mid + 7;
  }

  const handleMove: React.PointerEventHandler<SVGSVGElement> = (e) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xFrac = (e.clientX - rect.left) / rect.width;
    const svgX = xFrac * VBW;
    const idx = Math.round(((svgX - MARGIN.left) / plotW) * (n - 1));
    setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
  };

  const hoverLeftPct = hoverIdx !== null && n > 1 ? (hoverIdx / (n - 1)) * 100 : 0;
  const tooltipSide = hoverLeftPct > 60 ? "left" : "right";

  return (
    <div className="chart">
      <div className="chart-toolbar">
        {series.length > 1 && (
          <div className="chart-legend">
            {series.map((s) => (
              <span key={s.key} className="chart-legend-item">
                <span className="chart-legend-swatch" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
        )}
        <Button size="sm" variant="ghost" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Show chart" : "View as table"}
        </Button>
      </div>

      {showTable ? (
        <div className="chart-table-scroll">
          <Table>
            <thead>
              <tr>
                <th>Time</th>
                {series.map((s) => (
                  <th key={s.key}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timestamps
                .map((t, i) => ({ t, i }))
                .reverse()
                .map(({ t, i }) => (
                  <tr key={t}>
                    <td className="mono text-sm">{timeLabel(t)}</td>
                    {series.map((s) => (
                      <td key={s.key} className="mono text-sm">
                        {s.values[i] === null ? "—" : formatValue(s.values[i] as number)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </Table>
        </div>
      ) : (
        <div className="chart-plot">
          <svg
            ref={svgRef}
            className="chart-svg"
            viewBox={`0 0 ${VBW} ${height}`}
            preserveAspectRatio="none"
            onPointerMove={handleMove}
            onPointerLeave={() => setHoverIdx(null)}
          >
            {[0, 0.5, 1].map((f) => {
              const y = MARGIN.top + plotH * (1 - f);
              return (
                <g key={f}>
                  <line className="chart-gridline" x1={MARGIN.left} x2={VBW - MARGIN.right} y1={y} y2={y} />
                  <text className="chart-axis-label" x={MARGIN.left - 6} y={y} textAnchor="end" dominantBaseline="middle">
                    {axisFmt(yMax * f)}
                  </text>
                </g>
              );
            })}

            {[...new Set([0, n - 1])].map((i) => (
              <text
                key={i === 0 ? "start" : "end"}
                className="chart-axis-label"
                x={xAt(i)}
                y={height - 6}
                textAnchor={i === 0 ? "start" : "end"}
              >
                {timeLabel(timestamps[i])}
              </text>
            ))}

            {paths.map((p, i) => (
              <path key={p.key} className="chart-line" d={p.d} style={{ stroke: series[i].color }} />
            ))}

            {endLabels.map((e) => (
              <text key={e.key} className="chart-end-label" x={VBW - MARGIN.right + 4} y={e.y} dominantBaseline="middle" style={{ fill: e.color }}>
                {e.text}
              </text>
            ))}

            {hoverIdx !== null && (
              <g>
                <line className="chart-crosshair" x1={xAt(hoverIdx)} x2={xAt(hoverIdx)} y1={MARGIN.top} y2={MARGIN.top + plotH} />
                {series.map((s) => {
                  const v = s.values[hoverIdx];
                  if (v === null) return null;
                  return <circle key={s.key} className="chart-hover-dot" cx={xAt(hoverIdx)} cy={yAt(v)} r={4} style={{ fill: s.color }} />;
                })}
              </g>
            )}
          </svg>

          {hoverIdx !== null && (
            <div className={`chart-tooltip chart-tooltip-${tooltipSide}`} style={{ left: `${hoverLeftPct}%` }}>
              <div className="chart-tooltip-time">{timeLabel(timestamps[hoverIdx])}</div>
              {series.map((s) => {
                const v = s.values[hoverIdx];
                return (
                  <div key={s.key} className="chart-tooltip-row">
                    <span className="chart-tooltip-key" style={{ background: s.color }} />
                    <strong>{v === null ? "—" : formatValue(v)}</strong>
                    <span className="muted">{s.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
