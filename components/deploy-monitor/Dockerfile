# syntax=docker/dockerfile:1
# Deploy monitor (INIT-0038) — stays up and browser-reachable while `api` and
# `web` are rebuilt, so a redeploy is watchable instead of a blind wait on a
# dead site.
#
# Zero npm dependencies (Node built-ins only), so there is no `npm install`
# step and no lockfile to drift — the same rule `deploy-agent` follows, for the
# same reason: this is browser-facing, and the smallest possible supply chain
# is the point.
#
# Runs as root, deliberately and narrowly: certbot hardens
# /etc/letsencrypt/archive to 0700 root:root, so reading the TLS private key
# needs it. This container holds nothing else of value — no Docker socket, no
# git key, no write access to the app tree, no CAST_JWT_SECRET, and only a
# READ-ONLY credential to deploy-agent that cannot trigger a deploy.
FROM node:22-slim

WORKDIR /app

# Source only — no package.json, because there are no dependencies to install.
COPY components/deploy-monitor/server.js ./server.js
COPY components/deploy-monitor/public ./public

ENV NODE_ENV=production
ENV MONITOR_PORT=20443
EXPOSE 20443

# No HEALTHCHECK here: /healthz is served unauthenticated for exactly this
# purpose, but a compose-level healthcheck would add a `depends_on` surface for
# something whose entire value is being independent of the rest of the stack.
CMD ["node", "server.js"]
