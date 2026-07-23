# CAST API — runs TypeScript directly via tsx (no compile step), same
# "run the source" spirit as the SOC backend. Build context is the REPO ROOT.
FROM node:24-slim
WORKDIR /app
RUN corepack enable

# Manifests first for layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/config-schema/package.json packages/config-schema/package.json
COPY components/api/package.json components/api/package.json
RUN pnpm install --frozen-lockfile --filter @cast/api...

# Sources.
COPY packages/config-schema packages/config-schema
COPY components/api components/api

ENV NODE_ENV=production
ENV CAST_API_PORT=3001
EXPOSE 3001
WORKDIR /app/components/api
CMD ["pnpm", "start"]
