#!/usr/bin/env bash
# Increment the build stamp in version.json before a publish/deploy.
#
#   scripts/bump-build.sh            # increment build only (YYMM###, resets monthly)
#   scripts/bump-build.sh 0.2.0.0    # also set the product version (you pick the level)
#
# Build stamp = YYMM### per knowledge/conventions/versioning.md: 2-digit year +
# 2-digit month + 3-digit sequence within that month (resets to 001 each month).
# Product version (MAJOR.MINOR.PATCH.CORRECTION) is bumped deliberately by the
# author — pass it as an arg; MAJOR is never auto-bumped.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
F="$ROOT/version.json"
[ -f "$F" ] || { echo "Missing $F" >&2; exit 1; }

NEWVER="${1:-}"
YYMM="$(date -u +%y%m)"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"

node -e '
const fs = require("fs");
const f = process.argv[1], yymm = process.argv[2], ts = process.argv[3], sha = process.argv[4], newVer = process.argv[5];
const j = JSON.parse(fs.readFileSync(f, "utf8"));
const curMonth = String(j.build).slice(0, 4);
const seq = parseInt(String(j.build).slice(4), 10) || 0;
const next = curMonth === yymm ? seq + 1 : 1;              // reset to 001 on a new month
if (next > 999) throw new Error("build sequence exhausted for " + yymm);
j.build = yymm + String(next).padStart(3, "0");
if (newVer) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(newVer)) throw new Error("version must be MAJOR.MINOR.PATCH.CORRECTION");
  j.version = newVer;
}
j.builtAt = ts;
j.commit = sha;
fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
console.log(`v${j.version} · build ${j.build} · ${ts}`);
' "$F" "$YYMM" "$TS" "$SHA" "$NEWVER"
