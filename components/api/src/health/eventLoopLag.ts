/**
 * Process-wide "are we keeping up" gauge (INIT-0012's aisstream backpressure
 * question, but genuinely process-wide — anything that blocks the event loop
 * shows up here, not just AIS message handling). Node's own
 * `monitorEventLoopDelay` is the standard tool for this: it samples actual
 * loop delay via a native histogram, far more reliable than a hand-rolled
 * setTimeout-drift check. If this climbs, we're at real risk of falling
 * behind fast enough for aisstream to drop the connection (or any other
 * timing-sensitive work in this process to lag).
 */
import { monitorEventLoopDelay } from "perf_hooks";

const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

export interface EventLoopLag {
  meanMs: number;
  maxMs: number;
  p99Ms: number;
}

/** Reads the current stats and resets the histogram — each read covers the window since the last one. */
export function readEventLoopLag(): EventLoopLag {
  const meanMs = histogram.mean / 1e6;
  const maxMs = histogram.max / 1e6;
  const p99Ms = histogram.percentile(99) / 1e6;
  histogram.reset();
  return {
    meanMs: Number.isFinite(meanMs) ? meanMs : 0,
    maxMs: Number.isFinite(maxMs) ? maxMs : 0,
    p99Ms: Number.isFinite(p99Ms) ? p99Ms : 0,
  };
}
