/**
 * Backup freshness probe (INIT-0016 follow-on, 2026-08-18). Reads the SAME
 * dir `scripts/backup.sh` writes to (its own read-only mount — see
 * docker-compose.yml) and stats the newest tarball. Never opens/reads a
 * tarball's contents (they're root-600, secrets inside) — `stat()` only
 * needs search permission on the containing directory, not read access to
 * the file, so this works for `castapi` (uid 10001) without weakening the
 * archives' permissions at all.
 * Thresholds: daily backup at 02:00 UTC (`cast-backup.timer`) — danger past
 * 48h stale (missed two days), warn past 30h (missed today's window with
 * real margin, not just a few minutes of scheduler jitter).
 */
import { readdirSync, statSync } from "fs";
import { join } from "path";
import { config } from "../config";

export interface Probe { state: "ok" | "warn" | "down" | "idle"; detail: string; }

const BACKUP_RE = /^cast-backup-.*\.tar\.gz$/;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function getBackupFreshnessProbe(): Probe {
  try {
    const files = readdirSync(config.backupDir).filter((f) => BACKUP_RE.test(f));
    if (files.length === 0) {
      return { state: "warn", detail: `No backups found yet in ${config.backupDir}` };
    }
    const newest = files
      .map((f) => ({ f, stat: statSync(join(config.backupDir, f)) }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];
    const ageHours = (Date.now() - newest.stat.mtimeMs) / 3_600_000;
    const state = ageHours > 48 ? "down" : ageHours > 30 ? "warn" : "ok";
    return {
      state,
      detail: `Latest ${newest.f} — ${ageHours.toFixed(1)}h ago, ${formatBytes(newest.stat.size)} · ${files.length} retained`,
    };
  } catch (e) {
    return { state: "warn", detail: `Backup directory not reachable — ${e instanceof Error ? e.message : "unknown error"}` };
  }
}
