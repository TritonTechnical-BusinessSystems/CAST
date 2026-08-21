/**
 * Resource-usage time series for System Health (INIT-0016 follow-up,
 * 2026-08-17) — CPU/memory/disk-IO/storage charts, not just point-in-time
 * probes. Samples every METRIC_INTERVAL_MS and keeps a bounded in-memory ring
 * buffer (HISTORY_LIMIT samples ≈ 3h at the default interval) for the fast,
 * fine-grained recent path — a restart losing THIS part is fine, it's a live
 * dashboard, not an audit trail. Separately (INIT-0037), one sample a minute
 * is also persisted to `metric_history` (sqlite, same file as everything
 * else) and pruned past RETENTION_DAYS, so longer-range trend data survives
 * restarts and actually accumulates ahead of the Range-selector UI that will
 * read it — decimated, not averaged, and no querying/API surface for it yet.
 *
 * CPU/memory/block-IO/network come from the read-only docker-proxy's
 * `/containers/{id}/stats` (per-container cgroup counters, the same data
 * `docker stats` uses) — NOT `os.totalmem()`/`os.loadavg()`, which report the
 * *host's* raw values even from inside a container and would silently mix
 * host-wide numbers into what's meant to be this stack's own footprint.
 * Storage comes from `fs.statfs` on the bind-mounted data dir instead, since
 * that mount *is* the host filesystem for the volume that matters here.
 */
import { statfs } from "fs/promises";
import { config } from "../config";
import { DATA_DIR, db } from "../store/db";
import { getContainers } from "./containers";
import { readEventLoopLag } from "./eventLoopLag";

const METRIC_INTERVAL_MS = 15_000;
const HISTORY_LIMIT = 720; // 720 * 15s = 3h

// Persisted, downsampled history (INIT-0037) -- every PERSIST_EVERY_N_SAMPLES'th
// in-memory sample (not an average -- decimation, simple and sufficient for
// trend-viewing at this resolution) is written to `metric_history` so data
// survives restarts and accumulates toward the longer Range options that
// feature will add. 4 * 15s = 1 sample/minute; kept for RETENTION_DAYS, then
// pruned -- at ~1-2KB/row that's tens of MB even at 90 days, negligible next
// to the encrypted secrets table sharing this same file.
const PERSIST_EVERY_N_SAMPLES = 4;
const RETENTION_DAYS = 90;
let samplesSincePersist = 0;

const insertHistoryStmt = db.prepare(`INSERT INTO metric_history (at, sample_json) VALUES (@at, @sampleJson)`);
const pruneHistoryStmt = db.prepare(`DELETE FROM metric_history WHERE at < @cutoff`);

export interface ContainerSample {
  name: string;
  cpuPercent: number;
  memUsedBytes: number;
  memLimitBytes: number;
  memPercent: number;
  blockReadBytesPerSec: number;
  blockWriteBytesPerSec: number;
  netRxBytesPerSec: number;
  netTxBytesPerSec: number;
}

export interface MetricSample {
  at: string;
  /** Sum of per-container percent (each already normalized to "percent of one core" —
   *  docker's own convention), so a fully-loaded 2-core box tops out at 200, not 100. */
  cpuPercent: number;
  /** Host CPU cores, for turning cpuPercent into a percent of total capacity (cpuPercent / cpuCoreCount). */
  cpuCoreCount: number;
  memUsedBytes: number;
  memLimitBytes: number;
  memPercent: number;
  diskReadBytesPerSec: number;
  diskWriteBytesPerSec: number;
  netRxBytesPerSec: number;
  netTxBytesPerSec: number;
  storageUsedBytes: number;
  storageTotalBytes: number;
  storagePercent: number;
  eventLoopLagMeanMs: number;
  eventLoopLagP99Ms: number;
  eventLoopLagMaxMs: number;
  containers: ContainerSample[];
}

interface DockerStatsRaw {
  cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number; online_cpus?: number; percpu_usage?: number[] };
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number };
  memory_stats: { usage?: number; limit?: number; stats?: Record<string, number> };
  blkio_stats?: { io_service_bytes_recursive?: { op: string; value: number }[] };
  networks?: Record<string, { rx_bytes: number; tx_bytes: number }>;
}

const history: MetricSample[] = [];
let timer: NodeJS.Timeout | null = null;

// Cumulative counters (block-IO, network) only make sense as a rate — track
// the previous cumulative value + wall-clock per container to derive one,
// using the actual elapsed time rather than assuming a jitter-free interval.
const prevCounters = new Map<string, { at: number; blockRead: number; blockWrite: number; netRx: number; netTx: number }>();

function sumBlkio(raw: DockerStatsRaw["blkio_stats"], op: string): number {
  return (raw?.io_service_bytes_recursive ?? []).filter((e) => e.op.toLowerCase() === op).reduce((s, e) => s + e.value, 0);
}

function sumNet(raw: DockerStatsRaw["networks"], field: "rx_bytes" | "tx_bytes"): number {
  return Object.values(raw ?? {}).reduce((s, n) => s + (n[field] ?? 0), 0);
}

function cpuPercentOf(raw: DockerStatsRaw): number {
  const cpuDelta = raw.cpu_stats.cpu_usage.total_usage - raw.precpu_stats.cpu_usage.total_usage;
  const systemDelta = (raw.cpu_stats.system_cpu_usage ?? 0) - (raw.precpu_stats.system_cpu_usage ?? 0);
  if (cpuDelta <= 0 || systemDelta <= 0) return 0;
  const cpus = raw.cpu_stats.online_cpus ?? raw.cpu_stats.percpu_usage?.length ?? 1;
  return (cpuDelta / systemDelta) * cpus * 100;
}

function memUsedOf(raw: DockerStatsRaw): number {
  const usage = raw.memory_stats.usage ?? 0;
  // Docker includes page cache in `usage` — subtract it (cgroup v1 `cache`,
  // v2 `inactive_file`) so this reflects actual working-set pressure, matching
  // what `docker stats`' own MEM% column shows.
  const cache = raw.memory_stats.stats?.inactive_file ?? raw.memory_stats.stats?.cache ?? 0;
  return Math.max(0, usage - cache);
}

async function fetchContainerStats(id: string): Promise<DockerStatsRaw> {
  const res = await fetch(`${config.dockerProxyUrl}/containers/${id}/stats?stream=false`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`docker-proxy stats returned ${res.status}`);
  return (await res.json()) as DockerStatsRaw;
}

async function sampleContainers(nowMs: number): Promise<{ containers: ContainerSample[]; coreCount: number }> {
  const samples: ContainerSample[] = [];
  let coreCount = 1;
  let containers: Awaited<ReturnType<typeof getContainers>>;
  try {
    containers = await getContainers();
  } catch (e) {
    // docker-proxy itself unreachable (vs. a single container's stats
    // failing, already handled per-container below) -- don't let this abort
    // the whole sample. Storage and event-loop lag are independent signals
    // that stay useful even with zero container data, and INIT-0037's
    // persisted history should keep accumulating through a docker-proxy
    // blip, not silently stop collecting for however long it's down.
    console.warn("[metrics] getContainers failed -- recording this sample with no container data:", e instanceof Error ? e.message : e);
    return { containers: samples, coreCount };
  }
  for (const c of containers) {
    if (c.state !== "running") continue;
    try {
      const raw = await fetchContainerStats(c.name);
      coreCount = raw.cpu_stats.online_cpus ?? raw.cpu_stats.percpu_usage?.length ?? coreCount;
      const memLimitBytes = raw.memory_stats.limit ?? 0;
      const memUsedBytes = memUsedOf(raw);
      const blockRead = sumBlkio(raw.blkio_stats, "read");
      const blockWrite = sumBlkio(raw.blkio_stats, "write");
      const netRx = sumNet(raw.networks, "rx_bytes");
      const netTx = sumNet(raw.networks, "tx_bytes");

      const prev = prevCounters.get(c.name);
      const elapsedSec = prev ? Math.max(1, (nowMs - prev.at) / 1000) : METRIC_INTERVAL_MS / 1000;
      const rate = (curr: number, prevVal: number | undefined) => (prevVal === undefined || curr < prevVal ? 0 : (curr - prevVal) / elapsedSec);

      samples.push({
        name: c.name,
        cpuPercent: cpuPercentOf(raw),
        memUsedBytes,
        memLimitBytes,
        memPercent: memLimitBytes > 0 ? (memUsedBytes / memLimitBytes) * 100 : 0,
        blockReadBytesPerSec: rate(blockRead, prev?.blockRead),
        blockWriteBytesPerSec: rate(blockWrite, prev?.blockWrite),
        netRxBytesPerSec: rate(netRx, prev?.netRx),
        netTxBytesPerSec: rate(netTx, prev?.netTx),
      });
      prevCounters.set(c.name, { at: nowMs, blockRead, blockWrite, netRx, netTx });
    } catch (e) {
      console.warn(`[metrics] stats fetch failed for ${c.name}:`, e instanceof Error ? e.message : e);
    }
  }
  return { containers: samples, coreCount };
}

async function sampleStorage(): Promise<{ usedBytes: number; totalBytes: number; percent: number }> {
  try {
    const s = await statfs(DATA_DIR);
    const totalBytes = s.blocks * s.bsize;
    const freeBytes = s.bfree * s.bsize;
    const usedBytes = totalBytes - freeBytes;
    return { usedBytes, totalBytes, percent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0 };
  } catch (e) {
    console.warn("[metrics] statfs failed:", e instanceof Error ? e.message : e);
    return { usedBytes: 0, totalBytes: 0, percent: 0 };
  }
}

async function takeSample(): Promise<void> {
  const nowMs = Date.now();
  const [{ containers, coreCount }, storage] = await Promise.all([sampleContainers(nowMs), sampleStorage()]);
  const lag = readEventLoopLag();

  const sample: MetricSample = {
    at: new Date(nowMs).toISOString(),
    cpuPercent: containers.reduce((s, c) => s + c.cpuPercent, 0),
    cpuCoreCount: coreCount,
    memUsedBytes: containers.reduce((s, c) => s + c.memUsedBytes, 0),
    memLimitBytes: containers.reduce((max, c) => Math.max(max, c.memLimitBytes), 0),
    memPercent: 0,
    diskReadBytesPerSec: containers.reduce((s, c) => s + c.blockReadBytesPerSec, 0),
    diskWriteBytesPerSec: containers.reduce((s, c) => s + c.blockWriteBytesPerSec, 0),
    netRxBytesPerSec: containers.reduce((s, c) => s + c.netRxBytesPerSec, 0),
    netTxBytesPerSec: containers.reduce((s, c) => s + c.netTxBytesPerSec, 0),
    storageUsedBytes: storage.usedBytes,
    storageTotalBytes: storage.totalBytes,
    storagePercent: storage.percent,
    eventLoopLagMeanMs: lag.meanMs,
    eventLoopLagP99Ms: lag.p99Ms,
    eventLoopLagMaxMs: lag.maxMs,
    containers,
  };
  sample.memPercent = sample.memLimitBytes > 0 ? (sample.memUsedBytes / sample.memLimitBytes) * 100 : 0;

  history.push(sample);
  if (history.length > HISTORY_LIMIT) history.shift();

  samplesSincePersist++;
  if (samplesSincePersist >= PERSIST_EVERY_N_SAMPLES) {
    samplesSincePersist = 0;
    insertHistoryStmt.run({ at: sample.at, sampleJson: JSON.stringify(sample) });
    const cutoff = new Date(nowMs - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    pruneHistoryStmt.run({ cutoff });
  }
}

export function startMetricsSampler(): void {
  if (timer) return;
  takeSample().catch((e) => console.warn("[metrics] initial sample failed:", e instanceof Error ? e.message : e));
  timer = setInterval(() => {
    takeSample().catch((e) => console.warn("[metrics] sample failed:", e instanceof Error ? e.message : e));
  }, METRIC_INTERVAL_MS);
  timer.unref();
}

export function stopMetricsSampler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function getMetricsHistory(): { intervalSeconds: number; samples: MetricSample[] } {
  return { intervalSeconds: METRIC_INTERVAL_MS / 1000, samples: history };
}

export function getLatestMetricSample(): MetricSample | null {
  return history.length ? history[history.length - 1] : null;
}
