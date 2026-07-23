# CAST API — runs TypeScript directly via tsx (no compile step), same
# "run the source" spirit as the SOC backend. Build context is the REPO ROOT.
FROM node:24-slim
WORKDIR /app
RUN corepack enable

# Native build deps for better-sqlite3 (compiles from source if no prebuilt binary).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Manifests first for layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/config-schema/package.json packages/config-schema/package.json
COPY components/api/package.json components/api/package.json
COPY components/web/package.json components/web/package.json
RUN pnpm install --frozen-lockfile --filter @cast/api...

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
