/**
 * "Is the running deploy-monitor built from the current source?" (INIT-0038
 * follow-up).
 *
 * The monitor is deliberately excluded from `deploy.sh`'s `api web` scope so a
 * routine deploy can't restart it mid-stream — which means its image silently
 * lags the repo after any commit touching `components/deploy-monitor/`, with
 * nothing surfacing that. This computes the signal the System Health tile
 * needs.
 *
 * WHY A SOURCE HASH AND NOT A BUILD NUMBER: `version.json`'s build stamp
 * advances on every publish, most of which don't touch the monitor at all.
 * Comparing build stamps would report the monitor stale after essentially
 * every deploy — a permanent false alarm that would train everyone to ignore
 * the tile. Hashing the source answers the question actually being asked.
 *
 * Both sides hash the SAME four files in the SAME fixed order. `deploy-monitor`
 * has no build step and no dependencies, so it can't import this — the
 * equivalent lives in `components/deploy-monitor/server.js` as
 * `sourceFingerprint()`. THE TWO MUST STAY IN SYNC; changing the file list or
 * the digest here without changing it there makes every monitor look stale.
 *
 * Known gap, accepted: the monitor's own `Dockerfile` isn't in the hash (it
 * isn't present inside the built image to hash from the other side), so a
 * change to only the Dockerfile won't be flagged. Rare, and a rebuild is
 * harmless anyway.
 */
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

/** Fixed list + order. Mirrored exactly in deploy-monitor/server.js. */
export const MONITOR_SOURCE_FILES = ["server.js", "public/index.html", "public/app.js", "public/styles.css"] as const;

/** Where this container's copy of the monitor source lives (see components/api/Dockerfile). */
const MONITOR_SOURCE_DIR = join(process.cwd(), "..", "deploy-monitor");

export function fingerprintMonitorSource(dir = MONITOR_SOURCE_DIR): string | null {
  try {
    const h = createHash("sha256");
    for (const rel of MONITOR_SOURCE_FILES) {
      h.update(rel);
      h.update("\0");
      h.update(readFileSync(join(dir, rel)));
      h.update("\0");
    }
    return h.digest("hex").slice(0, 16);
  } catch {
    // Source not present (local dev running from source, or an api image built
    // before this file list existed). Callers treat null as "can't tell",
    // never as "stale" — guessing wrong in the alarming direction is worse
    // than saying nothing.
    return null;
  }
}
