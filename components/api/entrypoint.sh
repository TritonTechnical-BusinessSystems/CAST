#!/bin/sh
# Runs as root (the container's default/only user at boot) for exactly one
# reason: /app/components/api/.data is a host bind mount (docker-compose.yml)
# whose ownership the image can't fix at build time, since it doesn't exist
# in the image — only on the host, at deploy time. Fix it here, every start
# (idempotent, cheap), then drop to the unprivileged `castapi` user before
# ever running app code or launching Chromium. Chromium's real OS sandbox
# (pdf/render.ts intentionally does NOT pass --no-sandbox) refuses to
# activate as root by Chromium's own design — this is what makes that
# possible, not just a hardening nicety.
set -e
chown -R castapi:castapi /app/components/api/.data
# `su -c CMD -- a b c` sets $0=a, $1=b, $2=c for CMD's shell — so `"$@"`
# inside `-c 'exec "$@"'` would silently DROP the first real argument (it
# becomes $0, not part of $@) without the leading placeholder below.
exec su castapi -s /bin/sh -c 'exec "$@"' -- placeholder "$@"
