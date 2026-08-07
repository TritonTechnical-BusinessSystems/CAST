# syntax=docker/dockerfile:1
# CAST web (SPA) — build with Vite, serve static + proxy /api with nginx.
# Build context is the REPO ROOT (monorepo workspaces).
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/config-schema/package.json packages/config-schema/package.json
COPY components/web/package.json components/web/package.json
# Cache mount persists pnpm's content-addressable store across builds — on a
# lockfile change, only the diff re-downloads instead of the whole tree.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @cast/web...
COPY packages/config-schema packages/config-schema
COPY components/web components/web
# version.json changes on EVERY deploy (build number bump) — copied last, right
# before the one step that actually reads it, so it can't bust pnpm install's
# cache above on deploys where the lockfile hasn't changed.
COPY version.json ./
RUN pnpm --filter @cast/web build

FROM nginx:1.27-alpine
COPY components/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/components/web/dist /usr/share/nginx/html
EXPOSE 80
