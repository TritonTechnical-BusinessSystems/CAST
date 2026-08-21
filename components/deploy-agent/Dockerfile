# syntax=docker/dockerfile:1
# Deploy agent (INIT-0035) — the single most privileged container in this
# stack: real Docker socket + the git deploy key. Deliberately minimal —
# no pnpm/node_modules, no npm dependencies at all (server.js uses only
# Node's built-ins) — smaller attack surface matters more here than anywhere
# else in the app. Build context is the repo root, matching api/web.
FROM docker:27-cli AS dockercli

FROM node:22-slim
# Docker CLI + the `docker compose` plugin, copied from the official minimal
# CLI-only image rather than standing up Docker's apt repo just for two
# binaries (the standard "Docker-outside-of-Docker" pattern).
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY components/deploy-agent/server.js components/deploy-agent/deploy.sh components/deploy-agent/entrypoint.sh ./
RUN chmod +x deploy.sh entrypoint.sh

ENV DEPLOY_AGENT_PORT=4001
EXPOSE 4001
ENTRYPOINT ["/app/entrypoint.sh"]
