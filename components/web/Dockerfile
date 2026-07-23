# CAST web (SPA) — build with Vite, serve static + proxy /api with nginx.
# Build context is the REPO ROOT (monorepo workspaces).
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/config-schema/package.json packages/config-schema/package.json
COPY components/web/package.json components/web/package.json
RUN pnpm install --frozen-lockfile --filter @cast/web...
COPY packages/config-schema packages/config-schema
COPY components/web components/web
RUN pnpm --filter @cast/web build

FROM nginx:1.27-alpine
COPY components/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/components/web/dist /usr/share/nginx/html
EXPOSE 80
