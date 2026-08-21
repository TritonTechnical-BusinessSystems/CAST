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

# Machine-readable stage markers (INIT-0038). `deploy-monitor` parses these out
# of the log stream to drive its stage list, rather than guessing progress from
# elapsed time — which would be a lie the moment a build is slower or faster
# than usual. The `::stage::` prefix is deliberately unlike anything docker,
# git, or compose emit, so a line of build output can never be mistaken for a
# stage transition. The human-readable echo is kept alongside it: that's what
# actually shows in the log tape.
stage() {
  echo "::stage::$1"
  echo "== $2 =="
}

PULL=0
for arg in "$@"; do
  [ "$arg" = "--pull" ] && PULL=1
done

# Announced up front so the monitor can render the full expected sequence
# immediately (greyed out), instead of stages popping into existence one at a
# time with no sense of how many remain.
if [ "$PULL" = "1" ]; then
  echo "::plan::pull,build-api,build-web,up,prune"
else
  echo "::plan::build-api,build-web,up,prune"
fi

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
  stage pull "pulling latest main"
  git fetch --prune origin
  git checkout -q main
  git pull --ff-only origin main
  trap - EXIT
  chown -R "$ORIG_OWNER" "$APP_DIR"
fi

# Sequential, not parallel — this box is 2 vCPU/4GB and building both at once
# risks a memory-starved build failure.
stage build-api "building api image"
docker compose build api
stage build-web "building web image"
docker compose build web

stage up "starting containers"
# Scoped to api+web ONLY — a bare `docker compose up -d` would also recreate
# THIS container (deploy-agent is part of the same compose project), killing
# the very process running this script mid-deploy (caught in security
# review, 2026-08-21). deploy-agent's own image is never touched by a
# routine app deploy; it gets its own updates via a manual
# `docker compose up -d --build deploy-agent`, same as any other rare change.
docker compose up -d api web || { echo "retrying after old container settles..."; sleep 10; docker compose up -d api web; }
stage prune "pruning old images"
docker image prune -f >/dev/null 2>&1 || true
docker compose ps
echo "::stage::done"
