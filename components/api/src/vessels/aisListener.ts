/**
 * aisstream.io WS listener (INIT-0012 §3, "Phase A" — listener + latest-
 * position cache; the CW write-back is a separate later phase). Protocol
 * per knowledge/architecture/vessel-location-updating-aisstream.md §2: a
 * subscription message (APIKey + BoundingBoxes, optional MMSI filter) must
 * be sent within 3s of connecting; subsequent subscribe messages update the
 * filter (swap-and-replace, throttled to 1/s server-side).
 *
 * Two independent connections, matching the Tier 1/2 design (§3.6):
 *  - Tier 1: one dedicated, always-on subscription to its (<=50) MMSIs.
 *  - Tier 2: one subscription that ROTATES through its pool in batches of
 *    <=50 (a single connection can only watch 50 MMSIs at once) — periodic/
 *    best-effort coverage, not continuous.
 *
 * Reactivity: this module does NOT poll on its own. `jobs/tierRefresh.ts`
 * calls `applySplit()` the moment it recomputes the Tier 1/2 split (every 5
 * minutes by default, runtime-adjustable) — that's what keeps the MMSI
 * filters current. Tier 2's rotation timer is independent of that cadence
 * (it must keep cycling through however many vessels are in the pool
 * regardless of whether the pool itself just changed).
 *
 * Global bounding box (confirmed supported, see the architecture note) +
 * the MMSI filter is the whole filtering strategy — clients travel globally,
 * so there's no useful regional box.
 */
import { config, aisstreamConfigured } from "../config";
import { upsertPosition, upsertVoyage } from "./positionStore";
import { getSetting } from "../store/secretStore";
import { cleanAisString, parseAisEta } from "./aisEta";

const GLOBAL_BOUNDING_BOX: [[number, number], [number, number]] = [
  [-90, -180],
  [90, 180],
];

const TIER2_ROTATE_MS = 60_000; // "listen briefly, then swap" per the architecture note
const MAX_BACKOFF_MS = 60_000;
const BASE_BACKOFF_MS = 1_000;

export interface ConnState {
  connected: boolean;
  subscribedMmsiCount: number;
  lastMessageAt: string | null;
  messagesReceivedTotal: number;
  messagesReceivedLastMinute: number;
  reconnectCount: number;
  /** Time spent in onMessage (parse + upsert) — a direct "are we keeping up" gauge for this connection specifically. */
  avgProcessingMs: number;
  maxProcessingMs: number;
}

export interface AisListenerStatus {
  configured: boolean;
  tier1: ConnState;
  tier2: ConnState & { batchIndex: number; batchCount: number; poolSize: number };
}

interface AisEnvelope {
  MessageType?: string;
  Metadata?: { MMSI?: number; ShipName?: string; time_utc?: string };
  Message?: {
    PositionReport?: AisPositionFields;
    StandardClassBPositionReport?: AisPositionFields;
    ShipStaticData?: AisShipStaticFields;
  };
}
interface AisPositionFields {
  Latitude?: number;
  Longitude?: number;
  Sog?: number;
  Cog?: number;
  NavigationalStatus?: number;
}
interface AisShipStaticFields {
  Destination?: string;
  Eta?: unknown;
}

/** One managed WS connection: connects, subscribes, reconnects with backoff, parses positions in. */
class AisConnection {
  private ws: WebSocket | null = null;
  private mmsis: string[] = [];
  private backoffMs = BASE_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private messageTimestamps: number[] = [];
  /** [timestamp, durationMs] pairs for the last-minute window, same rolling-window pattern as messageTimestamps. */
  private processingSamples: [number, number][] = [];

  readonly state: ConnState = {
    connected: false,
    subscribedMmsiCount: 0,
    lastMessageAt: null,
    messagesReceivedTotal: 0,
    messagesReceivedLastMinute: 0,
    reconnectCount: 0,
    avgProcessingMs: 0,
    maxProcessingMs: 0,
  };

  constructor(private readonly label: string) {}

  /** Update the MMSI filter. Reconnects if not currently connected; otherwise sends an updated subscribe message on the open socket. */
  setMmsis(mmsis: string[]): void {
    const changed = mmsis.length !== this.mmsis.length || mmsis.some((m, i) => m !== this.mmsis[i]);
    this.mmsis = mmsis;
    this.state.subscribedMmsiCount = mmsis.length;
    if (!changed) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.subscribe();
    } else if (mmsis.length > 0 && !this.stopped) {
      this.connect();
    }
  }

  start(): void {
    this.stopped = false;
    if (this.mmsis.length > 0) this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.state.connected = false;
  }

  private connect(): void {
    if (this.stopped || this.mmsis.length === 0) return;
    const ws = new WebSocket(config.aisstreamWsUrl);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.subscribe();
      this.state.connected = true;
      this.backoffMs = BASE_BACKOFF_MS; // reset on a clean connect+subscribe
    });

    ws.addEventListener("message", (ev: MessageEvent) => {
      this.onMessage(ev.data);
    });

    ws.addEventListener("close", () => {
      this.state.connected = false;
      this.ws = null;
      if (this.stopped) return;
      this.state.reconnectCount++;
      const delay = this.backoffMs + Math.floor(Math.random() * 500); // jitter
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      console.warn(`[ais-listener:${this.label}] disconnected, reconnecting in ${delay}ms`);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });

    ws.addEventListener("error", () => {
      // The close handler (always fires after error) owns reconnect scheduling.
    });
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        APIKey: config.aisstreamApiKey,
        BoundingBoxes: [GLOBAL_BOUNDING_BOX],
        FiltersShipMMSI: this.mmsis,
      }),
    );
  }

  private onMessage(raw: unknown): void {
    const start = performance.now();
    let data: AisEnvelope;
    try {
      data = JSON.parse(String(raw));
    } catch {
      return;
    }
    const now = Date.now();
    this.state.lastMessageAt = new Date(now).toISOString();
    this.state.messagesReceivedTotal++;
    this.messageTimestamps.push(now);
    this.messageTimestamps = this.messageTimestamps.filter((t) => now - t < 60_000);
    this.state.messagesReceivedLastMinute = this.messageTimestamps.length;

    const mmsi = data.Metadata?.MMSI;
    const pos = data.Message?.PositionReport ?? data.Message?.StandardClassBPositionReport;
    if (mmsi != null && pos) {
      upsertPosition({
        mmsi: String(mmsi),
        lat: pos.Latitude ?? null,
        lon: pos.Longitude ?? null,
        sog: pos.Sog ?? null,
        cog: pos.Cog ?? null,
        navStatusCode: pos.NavigationalStatus ?? null,
        lastSeenAt: data.Metadata?.time_utc ?? new Date(now).toISOString(),
      });
    }

    const staticData = data.Message?.ShipStaticData;
    if (mmsi != null && staticData) {
      const destination = cleanAisString(staticData.Destination);
      const etaIso = parseAisEta(staticData.Eta, new Date(now));
      if (destination || etaIso) {
        upsertVoyage({ mmsi: String(mmsi), destination, etaIso, voyageUpdatedAt: new Date(now).toISOString() });
      } else if (staticData.Destination !== undefined || staticData.Eta !== undefined) {
        // Fields were present but didn't parse to anything usable — worth
        // knowing about given this whole mapping is unverified (see file header).
        console.warn(`[ais-listener:${this.label}] ShipStaticData for MMSI ${mmsi} had unparseable Destination/Eta:`, JSON.stringify(staticData).slice(0, 200));
      }
    }

    this.processingSamples.push([now, performance.now() - start]);
    this.processingSamples = this.processingSamples.filter(([t]) => now - t < 60_000);
    const durations = this.processingSamples.map(([, d]) => d);
    this.state.avgProcessingMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    this.state.maxProcessingMs = durations.length ? Math.max(...durations) : 0;
  }
}

const tier1 = new AisConnection("tier1");

/** Tier 2 rotates through its pool in batches of <=50 on its own timer, independent of the tier-refresh cadence. */
class Tier2Rotator {
  private pool: string[] = [];
  private batchIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly conn = new AisConnection("tier2");

  get state(): AisListenerStatus["tier2"] {
    return {
      ...this.conn.state,
      batchIndex: this.batchCount() === 0 ? 0 : this.batchIndex + 1,
      batchCount: this.batchCount(),
      poolSize: this.pool.length,
    };
  }

  private batchCount(): number {
    return Math.ceil(this.pool.length / 50) || 0;
  }

  setPool(mmsis: string[]): void {
    this.pool = mmsis;
    this.batchIndex = 0;
    this.applyCurrentBatch();
  }

  private applyCurrentBatch(): void {
    const batchCount = this.batchCount();
    if (batchCount === 0) {
      this.conn.setMmsis([]);
      return;
    }
    this.batchIndex %= batchCount;
    const batch = this.pool.slice(this.batchIndex * 50, this.batchIndex * 50 + 50);
    this.conn.setMmsis(batch);
  }

  start(): void {
    this.conn.start();
    this.timer = setInterval(() => {
      const batchCount = this.batchCount();
      if (batchCount <= 1) return; // nothing to rotate to
      this.batchIndex = (this.batchIndex + 1) % batchCount;
      this.applyCurrentBatch();
    }, TIER2_ROTATE_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.conn.stop();
  }
}

const tier2 = new Tier2Rotator();
let started = false;

export function startAisListener(): void {
  if (!aisstreamConfigured()) {
    console.warn("[ais-listener] CAST_AISSTREAM_API_KEY not set — listener not started");
    return;
  }
  started = true;
  // start() first (a no-op connect while each pool is still empty), THEN
  // apply the last-known split — applying it first would make setMmsis()
  // open a connection itself, and start() would open a second one on top.
  tier1.start();
  tier2.start();

  // jobs/tierRefresh.ts only runs its first cycle after a full interval
  // (up to 5 minutes) — apply whatever split was last persisted so the
  // listener doesn't sit idle with zero MMSIs on every restart.
  const lastSplit = getSetting<{ tier1: { mmsi: string }[]; tier2: { mmsi: string }[] }>("tracking.currentSplit");
  if (lastSplit) applySplit(lastSplit);

  console.log("[ais-listener] started (tier1 dedicated, tier2 rotating)");

  setInterval(() => {
    console.log(
      `[ais-listener] tier1: ${tier1.state.messagesReceivedLastMinute} msg/min, ${tier1.state.subscribedMmsiCount} MMSIs, connected=${tier1.state.connected} | ` +
        `tier2: ${tier2.state.messagesReceivedLastMinute} msg/min, batch ${tier2.state.batchIndex}/${tier2.state.batchCount}, connected=${tier2.state.connected}`,
    );
  }, 60_000);
}

export function stopAisListener(): void {
  if (!started) return;
  tier1.stop();
  tier2.stop();
  started = false;
}

/** Called by jobs/tierRefresh.ts the moment it recomputes the split — this is what keeps the MMSI filters current. */
export function applySplit(split: { tier1: { mmsi: string }[]; tier2: { mmsi: string }[] }): void {
  if (!aisstreamConfigured()) return;
  tier1.setMmsis(split.tier1.map((v) => v.mmsi).filter(Boolean));
  tier2.setPool(split.tier2.map((v) => v.mmsi).filter(Boolean));
}

export function getAisStatus(): AisListenerStatus {
  return { configured: aisstreamConfigured(), tier1: { ...tier1.state }, tier2: tier2.state };
}
