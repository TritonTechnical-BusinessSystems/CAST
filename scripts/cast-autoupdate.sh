#!/usr/bin/env bash
# Unattended GA-only auto-update: check out the latest General-Availability
# release tag and redeploy. Driven by cast-autoupdate.timer. "GA only" = product
# version tags vMAJOR.MINOR.PATCH.CORRECTION with NO pre-release suffix ('-').
# Pull-based; needs only outbound access to GitHub (which trt-cast-01 has).
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/cast/app}"
LOG="${CAST_UPDATE_LOG:-/var/log/cast-autoupdate.log}"
exec >>"$LOG" 2>&1

echo "=== $(date -u +%FT%TZ) cast auto-update check ==="
cd "$APP_DIR"
git fetch --tags --prune origin >/dev/null 2>&1 || { echo "fetch failed"; exit 0; }

# Latest GA tag (semver-ish sort, exclude any pre-release with a '-').
LATEST=$(git tag -l 'v*' | grep -vE '-' | sort -V | tail -1 || true)
if [ -z "$LATEST" ]; then echo "no GA release tag yet; nothing to do"; exit 0; fi

CURRENT=$(git describe --tags --exact-match 2>/dev/null || echo "none")
if [ "$LATEST" = "$CURRENT" ]; then echo "already on latest GA ($CURRENT)"; exit 0; fi

echo "updating: $CURRENT -> $LATEST"
git checkout -q "$LATEST"
docker compose up -d --build
docker image prune -f >/dev/null 2>&1 || true
echo "deployed $LATEST"
