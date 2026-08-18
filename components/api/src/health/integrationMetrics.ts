/**
 * Integration performance time series (INIT-0016 follow-on, 2026-08-18) —
 * ConnectWise response latency + AIS message-processing latency, charted
 * over time next to the resource-usage charts. Deliberately reuses calls
 * that ALREADY happen rather than adding new polling load: `/health/full`
 * already pings ConnectWise every ~15s (frontend's own poll interval) for
 * the existing probe card, and the AIS listener already computes
 * avg/max processing time per message for its own probe detail — this
 * module just times/records those same calls into a ring buffer instead of
 * discarding the number after formatting one sentence.
 *
 * TrackingMore is deliberately NOT included: unlike CW, there's no probe
 * that already calls it periodically, and it's a metered third-party API —
 * adding a new poll loop just to chart it isn't worth the added usage
 * against the account's quota for a health dashboard.
 */
const HISTORY_LIMIT = 720; // matches metrics.ts's 3h-at-15s scale

export interface IntegrationSample {
  at: string;
  cw: { latencyMs: number; ok: boolean } | null; // null = not configured
  aisTier1: { avgProcessingMs: number; maxProcessingMs: number } | null;
  aisTier2: { avgProcessingMs: number; maxProcessingMs: number } | null;
}

const history: IntegrationSample[] = [];

export function recordIntegrationSample(sample: IntegrationSample): void {
  history.push(sample);
  if (history.length > HISTORY_LIMIT) history.shift();
}

export function getIntegrationMetricsHistory(): { samples: IntegrationSample[] } {
  return { samples: history };
}
