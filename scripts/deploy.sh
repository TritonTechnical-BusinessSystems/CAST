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
echo "== building images (sequentially — this box is 2 vCPU/4GB; building both at once risks a memory-starved build failure) =="
docker compose build api
docker compose build web
echo "== starting containers =="
# api's old instance can briefly go unhealthy while shutting down (SIGTERM
# racing better-sqlite3's native cleanup — fixed going forward, but the
# outgoing container on an upgrade deploy may still be running old code), and
# web's depends_on:service_healthy then refuses to start, aborting `up -d`
# without retrying. One retry after a short wait covers that window.
docker compose up -d || { echo "retrying after old container settles..."; sleep 10; docker compose up -d; }
docker image prune -f >/dev/null 2>&1 || true
docker compose ps
