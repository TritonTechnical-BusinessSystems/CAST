#!/usr/bin/env bash
# Runs once per container start (not per-request). Two jobs:
#  1. Set up SSH so `git pull` in deploy.sh can reach GitHub via the mounted
#     deploy key. The key is bind-mounted read-only from the host; SSH
#     refuses to use a key with group/other read permissions or one it can't
#     treat as writable-by-owner-only, so it's copied to a private,
#     correctly-permissioned location here rather than used in place.
#  2. Pin GitHub's own published SSH host key rather than trust-on-first-use
#     (security review, 2026-08-21 — `StrictHostKeyChecking accept-new` would
#     silently accept whatever key is presented on the very first connection,
#     a real if narrow MITM window for a container whose whole job is to git
#     pull code that then gets built and run with Docker-socket-equivalent
#     privilege). Key published at
#     https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
set -euo pipefail
mkdir -p /root/.ssh
cp "${DEPLOY_KEY_HOST_PATH:-/home/tritonadmin/.ssh/cast-deploy-agent-key}" /root/.ssh/deploy_key
chmod 600 /root/.ssh/deploy_key

cat > /root/.ssh/known_hosts <<'EOF'
github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
EOF
chmod 600 /root/.ssh/known_hosts

cat > /root/.ssh/config <<EOF
Host github.com-cast
  HostName github.com
  User git
  IdentityFile /root/.ssh/deploy_key
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  UserKnownHostsFile /root/.ssh/known_hosts
EOF
chmod 600 /root/.ssh/config

# `deploy.sh` operates on /opt/cast/app, host-owned by tritonadmin — git
# refuses by default to touch a repo it doesn't itself own when running as a
# different uid (root here), a real hard stop that would otherwise fail
# every "Update from git + Redeploy" (caught in security review, 2026-08-21).
git config --global --add safe.directory /opt/cast/app

exec node server.js
