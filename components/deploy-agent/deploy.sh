#!/usr/bin/env bash
# Executed ONLY by server.js as a child process — never run interactively.
# Same core steps as scripts/deploy.sh (which tritonadmin still runs by hand
# for a manual deploy), adapted for this container: no root-check, since this
# container's entire purpose requires Docker-socket-equivalent privilege
# already — restricting its own root doesn't add real isolation. The real
# isolation boundary is this container being SEPARATE from cast-api, which
# never gets the socket or the deploy key at all.
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/cast/app}"
cd "$APP_DIR"

PULL=0
for arg in "$@"; do
  [ "$arg" = "--pull" ] && PULL=1
done

if [ "$PULL" = "1" ]; then
  # git operations run as root (see entrypoint.sh's safe.directory config),
  # but $APP_DIR is host-owned by tritonadmin — anything git writes (new
  # objects, updated refs) would otherwise end up root-owned, breaking
  # tritonadmin's own manual `scripts/deploy.sh` afterward (permission denied
  # on root-owned files). Restore the original owner once the pull is done,
  # via a trap so it runs on ANY exit from this point on — not just the
  # success path. `set -e` means `git fetch`/`checkout`/`pull` failing (a
  # non-fast-forward, a dirty tree, a network blip) would otherwise abort the
  # script BEFORE the chown ever ran, corrupting ownership at exactly the
  # moment the operator needs the manual `scripts/deploy.sh` fallback to
  # still work (caught on a second security-gate pass, 2026-08-21 — the first
  # fix only handled the success path).
  ORIG_OWNER="$(stat -c '%u:%g' "$APP_DIR")"
  trap 'chown -R "$ORIG_OWNER" "$APP_DIR"' EXIT
  echo "== pulling latest main =="
  git fetch --prune origin
  git checkout -q main
  git pull --ff-only origin main
  trap - EXIT
  chown -R "$ORIG_OWNER" "$APP_DIR"
fi

echo "== building images (sequentially — this box is 2 vCPU/4GB) =="
docker compose build api
docker compose build web

echo "== starting containers =="
# Scoped to api+web ONLY — a bare `docker compose up -d` would also recreate
# THIS container (deploy-agent is part of the same compose project), killing
# the very process running this script mid-deploy (caught in security
# review, 2026-08-21). deploy-agent's own image is never touched by a
# routine app deploy; it gets its own updates via a manual
# `docker compose up -d --build deploy-agent`, same as any other rare change.
docker compose up -d api web || { echo "retrying after old container settles..."; sleep 10; docker compose up -d api web; }
docker image prune -f >/dev/null 2>&1 || true
docker compose ps
