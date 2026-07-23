#!/usr/bin/env bash
# Manual deploy of the current main branch. Run on trt-cast-01.
# (Unattended GA-only updates are handled by cast-autoupdate.sh + its timer.)
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/cast/app}"
cd "$APP_DIR"
echo "== pulling latest main =="
git fetch --prune origin
git checkout -q main
git pull --ff-only origin main
echo "== building + starting containers =="
docker compose up -d --build
docker image prune -f >/dev/null 2>&1 || true
docker compose ps
