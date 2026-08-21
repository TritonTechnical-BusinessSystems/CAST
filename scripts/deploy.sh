#!/usr/bin/env bash
# Manual deploy of the current main branch. Run on trt-cast-01 AS tritonadmin
# — do NOT sudo this script. tritonadmin is already in the `docker` group
# (no sudo needed for any docker/compose command here), and running as root
# instead breaks `git fetch`/`pull`: the deploy key + its `github.com-cast`
# SSH host alias live in tritonadmin's ~/.ssh, not root's, so a sudo'd run
# fails immediately with "Could not resolve hostname github.com-cast"
# (confirmed live 2026-08-14).
# (Unattended GA-only updates are handled by cast-autoupdate.sh + its timer.)
set -euo pipefail
if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as tritonadmin, not root/sudo -- see the comment at the top of this script." >&2
  exit 1
fi
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
# `docker image prune` above only removes dangling IMAGES -- BuildKit's build
# cache is a completely separate store it never touches, and nothing else on
# this host ever swept it either. Found live 2026-08-21: 17.38GB of an ~25GB
# disk was build cache going back a full 4 weeks, none of it backing any
# running container. Bounded to 7 days (not a full wipe) so the most recent
# builds' cache stays warm -- deliberately not `-a` (all), which would erase
# the cache for the current api/web tags too and make the NEXT build on this
# 2 vCPU box slow for no reclaim benefit, since that cache is still in active
# use.
docker builder prune -f --filter until=168h >/dev/null 2>&1 || true
docker compose ps
