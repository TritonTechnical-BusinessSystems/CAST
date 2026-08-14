# syntax=docker/dockerfile:1
# CAST API — runs TypeScript directly via tsx (no compile step), same
# "run the source" spirit as the SOC backend. Build context is the REPO ROOT.
#
# Pinned to node:22-slim (not 24): better-sqlite3 v11.x crashes on Node 24 at
# runtime (WiseLibs/better-sqlite3#1376 — assertion in
# RemoveEnvironmentCleanupHook when a Statement is GC'd), confirmed live on
# this app. Node 22 satisfies the >=22 engines floor and is the documented
# working version. Revisit if better-sqlite3 publishes real Node 24 support.
#
# Multi-stage: the build toolchain (python3/make/g++, needed only to compile
# better-sqlite3's native module) never reaches the final image — it's ~150-
# 300MB of compiler + headers with zero runtime purpose, and it's the single
# biggest thing this build exports/unpacks on every deploy.
FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Manifests first for layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/config-schema/package.json packages/config-schema/package.json
COPY components/api/package.json components/api/package.json
COPY components/web/package.json components/web/package.json
# Cache mount persists pnpm's content-addressable store across builds — on a
# lockfile change, only the diff re-downloads instead of the whole tree.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @cast/api...

FROM node:22-slim
WORKDIR /app
RUN corepack enable
# ca-certificates is a RUNTIME dependency too (outbound HTTPS to ConnectWise,
# aisstream, OSV.dev, LDAPS) — kept here; python3/make/g++ are not.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Unprivileged app user (security review, INIT-0026 Phase 3) — Chromium's own
# real OS sandbox refuses to activate as root (Chromium's design, not a
# Docker limitation), and this is the one container that can decrypt every
# stored ConnectWise credential, so it should never run as root regardless of
# Chromium. Fixed uid/gid so the host-side bind mount (/opt/cast/data) can be
# chowned to match deterministically. Actually dropped to at runtime by
# entrypoint.sh, not here — this stage still runs as root through the
# Playwright/Chromium install below, which needs root to apt-install
# Chromium's runtime library dependencies.
RUN groupadd -g 10001 castapi && useradd -u 10001 -g castapi -m -d /home/castapi -s /usr/sbin/nologin castapi

# Fixed, HOME-independent browser install path (INIT-0026 Phase 3) — Playwright
# defaults to caching under whichever user's $HOME ran `playwright install`;
# pinning this explicitly means the browser Chromium loads at runtime (as
# `castapi`) is unambiguously the one installed here at build time (as root),
# not a HOME-resolution accident. `--with-deps` auto-detects this Debian base
# and apt-installs exactly the shared libraries Chromium needs to run headless
# — the actual fix for the Dockerfile never having installed them before.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
RUN npx --yes playwright@1.62.1 install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# The full /app tree as pnpm left it — node_modules lives in more than one
# place under pnpm's workspace layout (root + each package's own symlink dir).
COPY --from=deps /app /app
# `corepack enable` alone only installs shims — pnpm itself is fetched lazily
# on first invocation. In the old single-stage build that happened for free
# during `pnpm install`; here it must be forced explicitly at BUILD time
# (reads the pin from package.json above), or the container's first start
# would reach out to the npm registry before it could run at all.
RUN pnpm --version

# Sources.
COPY packages/config-schema packages/config-schema
COPY components/api components/api
# Extension installer files the web app serves for download (deploy tab).
COPY components/browser-extension/deploy components/browser-extension/deploy
# Read directly by routes/health.ts (System Health "Application" card) — kept
# out of the `deps` stage so bumping the build number doesn't bust its cache.
COPY version.json ./

# Everything except the bind-mounted .data dir (host-owned at deploy time,
# fixed up by entrypoint.sh on every container start instead) can be owned by
# the app user once, here, at build time.
RUN chown -R castapi:castapi /app /opt/playwright-browsers
# Defensive — git doesn't always preserve the executable bit reliably across
# every clone/checkout path onto the deploy host.
RUN chmod +x /app/components/api/entrypoint.sh

ENV NODE_ENV=production
ENV CAST_API_PORT=3001
EXPOSE 3001
WORKDIR /app/components/api
ENTRYPOINT ["/app/components/api/entrypoint.sh"]
CMD ["pnpm", "start"]
