# syntax=docker/dockerfile:1
# CAST API — runs TypeScript directly via tsx (no compile step), same
# "run the source" spirit as the SOC backend. Build context is the REPO ROOT.
#
# Multi-stage: the build toolchain (python3/make/g++, needed only to compile
# better-sqlite3's native module) never reaches the final image — it's ~150-
# 300MB of compiler + headers with zero runtime purpose, and it's the single
# biggest thing this build exports/unpacks on every deploy.
FROM node:24-slim AS deps
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

FROM node:24-slim
WORKDIR /app
RUN corepack enable
# ca-certificates is a RUNTIME dependency too (outbound HTTPS to ConnectWise,
# aisstream, OSV.dev, LDAPS) — kept here; python3/make/g++ are not.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# The full /app tree as pnpm left it — node_modules lives in more than one
# place under pnpm's workspace layout (root + each package's own symlink dir).
COPY --from=deps /app /app

# Sources.
COPY packages/config-schema packages/config-schema
COPY components/api components/api
# Extension installer files the web app serves for download (deploy tab).
COPY components/browser-extension/deploy components/browser-extension/deploy

ENV NODE_ENV=production
ENV CAST_API_PORT=3001
EXPOSE 3001
WORKDIR /app/components/api
CMD ["pnpm", "start"]
