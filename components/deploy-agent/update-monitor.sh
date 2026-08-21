#!/usr/bin/env bash
# Rebuilds and restarts `deploy-monitor` ONLY (INIT-0038).
#
# Why this exists as its own action: a routine deploy (`deploy.sh`) is scoped
# to `api web` precisely so it can't recreate long-lived infrastructure
# containers mid-run — which means `deploy-monitor`'s own image is never
# refreshed by a normal deploy, and would silently drift stale after any commit
# that changes its code. Without an in-app path to update it, the only way to
# pick up a monitor change would be an SSH session, which is exactly the thing
# this whole initiative exists to remove.
#
# Deliberately NOT part of deploy.sh: rebuilding the monitor while it is
# actively streaming a deploy to someone's browser would kill that stream
# partway through. This runs on its own, from the System Health page, when no
# deploy is in flight.
#
# `deploy-agent` (this container) is still never in the service list — it is
# the process running this script, and recreating it here would kill the run
# mid-flight, the same footgun caught in INIT-0035's security review.
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/cast/app}"
cd "$APP_DIR"

echo "::plan::build-monitor,up-monitor"
echo "::stage::build-monitor"
echo "== building deploy-monitor image =="
docker compose build deploy-monitor

echo "::stage::up-monitor"
echo "== restarting deploy-monitor =="
docker compose up -d deploy-monitor

docker image prune -f >/dev/null 2>&1 || true
docker compose ps deploy-monitor
echo "::stage::done"
