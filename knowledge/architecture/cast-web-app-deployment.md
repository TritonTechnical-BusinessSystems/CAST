---
status: active
read-when: Deploying CAST to trt-cast-01, or changing container topology, nginx, TLS, or the auto-update mechanism.
related: [cast-web-app-vm-provisioning.md, connectwise-api-integration.md, ../decisions/0006-web-app-stack-vite-react-express.md]
updated: 2026-08-21
---

# CAST web app — deployment

Docker on `trt-cast-01` (internal-only: outbound internet yes, inbound no). Pattern
mirrors Logistics Coordinator. **DEPLOYED 2026-07-23 — live at
`https://cast.tritontechnical.com`** with a real, auto-renewing Let's Encrypt cert
(acme-dns DNS-01) and the GA auto-update timer enabled. App dir `/opt/cast/app`.

**Published ports (the complete list — nothing else is reachable from the host):**
`80` and `443` from `web`, and `20443` from `deploy-monitor` (`INIT-0038`). Every
other container — `api`, `deploy-agent`, `docker-proxy` — has no `ports:` entry at
all and is reachable only container-to-container. `20443` was chosen over the more
common `8443` to leave that port free for something else later.

## Topology (`docker-compose.yml`)
- **docker-proxy** (`tecnativa/docker-socket-proxy`) — read-only view of the Docker
  daemon for System Health's container inventory (`INIT-0016`) and per-container
  resource-usage metrics (`components/api/src/health/metrics.ts` — CPU/memory/disk-IO/
  network charts, dataviz skill). `api` talks to this, never the raw socket — only
  `CONTAINERS` and `STATS` (both GET) are allow-listed, and it's never published to
  the host, only reachable from `api` on the internal network.
- **api** (`@cast/api`, Express via tsx, multi-stage build) — internal only;
  encrypted store persisted via a **host bind mount** `/opt/cast/data` →
  `/app/components/api/.data` (not a named volume — `scripts/backup.sh` reads it
  directly). Depends on `docker-proxy`.
  - **One more read-only host mount** (System Health's backup-freshness probe,
    `INIT-0016`): `/opt/cast/backups:ro` (`scripts/backup.sh`'s output dir).
    `api` never writes here — `health/backupFreshness.ts` only `stat()`s the
    newest tarball (name/size/mtime), never opens one; the root-600 archives
    (`0755` dir, `0600` files — verified live) stay unreadable to `castapi`
    regardless of the mount. **TLS expiry does NOT get a mount** — certbot
    hardens `/etc/letsencrypt/archive/<domain>` to `0700 root:root` (verified
    live), so an unprivileged reader can't resolve the `live/` symlink into
    it; `health/certExpiry.ts` does a real TLS handshake to `web:443` instead
    (container-to-container over the internal bridge, same pattern as
    `internalWebUrl` below) — reads the SAME cert nginx actually serves, no
    mount or permission dependency at all.
  - **Runs as an unprivileged user, not root** (INIT-0026 Phase 3 security
    review) — `entrypoint.sh` starts as root just long enough to `chown` the
    bind-mounted `.data` dir (its host ownership can't be baked into the
    image at build time), then `su`s into `castapi` (fixed uid `10001`)
    before ever executing app code. This is what lets Chromium's real OS
    sandbox stay on for PDF generation (`pdf/render.ts` deliberately does
    NOT pass `--no-sandbox` — Chromium refuses to sandbox itself as root by
    its own design, which is the usual reason that flag shows up in
    Docker). Verified live: `docker exec cast-api cat /proc/1/status` (or
    any real PID) shows `Uid: 10001`, not `0`.
  - **Playwright/Chromium is a real build-time dependency of this image**
    (`npx playwright install --with-deps chromium`, pinned to the exact
    `playwright` version in `package.json` — a version mismatch here means
    the browser binary Chromium loads at runtime silently won't match what
    `pdf/render.ts` expects). `PLAYWRIGHT_BROWSERS_PATH` is set to a fixed,
    HOME-independent path so the browser installed as root at build time is
    still found once the process drops to `castapi` at runtime.
- **web** (built from `components/web/Dockerfile`, final stage `nginx:1.27-alpine`)
  — serves the SPA + proxies `/api` → `api:3001`, terminates TLS, publishes
  80+443, bind-mounts `/etc/letsencrypt:ro`. `depends_on: api` (`service_healthy`).
- **deploy-agent** (`INIT-0035`, `components/deploy-agent/`) — the ONLY
  container holding the real Docker socket (read-write, not the read-only
  proxy) and a git deploy key, so `api` (which decrypts every stored
  credential) never needs either directly. **Not itself a secrets-free or
  safe-if-compromised component** — it bind-mounts the whole app tree
  read-write (including `components/api/.env`) to drive `git pull`/`docker
  compose`, and Docker socket access is host-root-equivalent by nature
  (security review, 2026-08-21, correcting an earlier overclaim here). What
  the split actually buys: `api`'s own code/dependencies/request-handling —
  the only part of the credential-holding process an outside attacker can
  reach — can never touch Docker or the deploy key, only this agent's two
  fixed actions. Backs System Health's "Redeploy"/"Update from git +
  Redeploy" buttons: `api` calls those two fixed, token-authenticated actions
  over a **dedicated `deploy` network** (not `internal` — `web`, the only
  internet-facing container, and `docker-proxy` have no network path to the
  agent at all; no `ports:` entry either way). Zero npm dependencies by
  design (Node built-ins only) — the single most privileged container in the
  stack should have the smallest attack surface. Uses its OWN dedicated
  deploy key (`cast-deploy-agent-key`, a separate GitHub Deploy Key, not
  `tritonadmin`'s interactive one), delivered as a plain read-only bind mount
  at the identical host path (NOT Compose `secrets:` — that mechanism is
  resolved by whichever `docker compose` CLI process is running, which is
  this container itself when it redeploys, not the host, so a `secrets:`
  file source never resolved correctly) and copied to a correctly-
  permissioned location by `entrypoint.sh` at container start, which also
  pins GitHub's published SSH host key rather than trusting whatever's
  presented on first connection. Requires `DEPLOY_AGENT_TOKEN` (a shared
  bearer token) set in `components/api/.env` — the SAME file `api` reads,
  not Compose-level `${VAR}` shell interpolation, which would need a root
  `.env` this deploy's layout doesn't have; the deploy UI just hides itself
  if unset (e.g.
  local dev, which has no `deploy-agent` container at all).
- **deploy-monitor** (`INIT-0038`, `components/deploy-monitor/`) — the one
  container that stays up and **browser-reachable during a redeploy**, so a
  deploy is watchable instead of a blind ~3.5-minute wait on a dead site.
  Necessary because `deploy.sh` rebuilds `api` and `web`: anything served by
  `web` and fed by `api` goes dark for exactly the window it was meant to
  report on. Publishes **20443** with its own TLS (same `/etc/letsencrypt:ro`
  mount `web` uses), so it survives `web` restarting. Sits on the `deploy`
  network to reach the agent.
  **The least-privileged container in the stack, deliberately** — it is the
  only new browser-facing surface: no Docker socket, no git key, no write
  access to the app tree, and critically **no `CAST_JWT_SECRET`** (CAST signs
  sessions HS256/symmetric, so a container able to verify a session could also
  forge an admin one). It holds only `DEPLOY_AGENT_READONLY_TOKEN`, which
  `deploy-agent` accepts on `GET /status` and **refuses (403) on every POST** —
  it can watch a deploy, never start one. The agent refuses to boot if that
  token equals `DEPLOY_AGENT_TOKEN`, since that would make the split
  decorative.
  **It has its OWN `components/deploy-monitor/.env`**, not the shared
  `components/api/.env` every other service uses — `env_file` loads the whole
  file, so the shared one would put `CAST_JWT_SECRET`, `CAST_SECRET_KEY`, the
  LDAP bind password and the FULL `DEPLOY_AGENT_TOKEN` into this browser-facing
  process, making the read-only split decorative (security gate BLOCK,
  2026-08-21). That file is `required: false` in compose deliberately: a plain
  `env_file:` pointing at a file a host hasn't provisioned yet makes *every*
  `docker compose` command fail, `deploy.sh`'s own builds included. Browser access uses a short-lived **stateless HMAC watch token**
  minted by `api` only after `requirePermission("system.deploy")` passes,
  verified by recomputation and failing closed in both time directions. Zero
  npm dependencies, same rule as the agent. Runs as **root** for exactly one
  reason: certbot hardens `/etc/letsencrypt/archive` to `0700 root:root`, so
  the TLS private key is unreadable otherwise.
  **It reloads its own TLS**: certbot's renewal deploy-hook reloads the `web`
  service by name only and knows nothing about this container, so `server.js`
  watches its cert files and swaps the secure context in place — otherwise it
  would silently serve a stale certificate ~60 days after the next renewal.
  **Not in `deploy.sh`'s `api web` scope**, so a routine deploy never restarts
  it mid-stream; it updates via its own `update-monitor.sh` agent action
  (System Health → Deploy card → "Update deploy monitor"), which is the only
  non-SSH way to pick up a change to it.
All `restart: unless-stopped`. Secrets via `components/api/.env` (git-ignored).

## nginx (`components/web/nginx.conf`)
`80 → 301 https`. `443 ssl` serves the SPA (try_files fallback, immutable asset
cache, no-store `index.html`) + proxies `/api` with a runtime `resolver` so nginx
starts even if `api` is briefly down.

A third block, **`listen 8080`, is internal-only** — no `ports:` entry in
`docker-compose.yml`, so it's reachable only from other containers on the
`internal` network, never the host/internet. It exists solely so the `api`
container's headless-Chromium PDF render (`pdf/render.ts`,
`CAST_INTERNAL_WEB_URL`, default `http://web:8080`) can reach this same SPA
without hitting the 443 block's certificate (issued for the public hostname,
not the internal Docker DNS name `web`) or the 80 block's https redirect,
either of which would send that internal request into a TLS mismatch.
Mirrors LogisticsCoordinator's own proven `nginx:8080` internal pattern.

## TLS — acme-dns DNS-01 (LC's exact method)
Real certs need only **outbound** (available here). Interim: **self-signed** via
`scripts/setup-tls.sh`; real-cert steps are in that script and `vm-provisioning §7`.
Renewal: `certbot.timer`; a deploy-hook reloads nginx.

## Deploy
- App dir on VM: `/opt/cast/app` (git clone via the read-only deploy key).
- **Run `deploy.sh` as `tritonadmin`, never `sudo`** — the deploy key + its
  `github.com-cast` SSH host alias live in `tritonadmin`'s `~/.ssh`, not
  root's, so a sudo'd run fails at `git fetch` with "Could not resolve
  hostname github.com-cast". No sudo is needed anyway: `tritonadmin` is
  already in the `docker` group. The script itself refuses to run as root
  (confirmed live 2026-08-14).
- **Manual:** `scripts/deploy.sh` — pulls `main`, builds `api` and `web`
  **sequentially** (the VM is 2 vCPU/4GB; building both at once has caused a
  memory-starved build failure), then `docker compose up -d` with one retry
  after a short wait (covers a transient window where the outgoing container
  is still settling and `web`'s health-gated dependency aborts the first try).
- **Unattended GA-only:** `scripts/cast-autoupdate.sh` + `scripts/systemd/cast-autoupdate.{service,timer}`
  — daily; checks out the latest **GA** tag (`vX.Y.Z.C`, no pre-release suffix) and
  redeploys. Pull-based (outbound only). Install: copy units to `/etc/systemd/system`,
  `systemctl enable --now cast-autoupdate.timer`.
- **Host OS patching:** enable `unattended-upgrades` for security updates.

## Backups
Strong backup of all non-git runtime state (code already lives in git):
- **`scripts/backup.sh`** — a **consistent (WAL-safe)** sqlite snapshot
  (better-sqlite3 online backup) + `secret.key`, `.env`, the extension signing key,
  and the acme-dns account (`/etc/letsencrypt/acmedns.json`), tarred **root-600** to
  `/opt/cast/backups`, keeping the newest 14 (`CAST_BACKUP_KEEP`).
- **Scheduled** daily 02:00 via `scripts/systemd/cast-backup.{service,timer}`.
- **Restore:** `sudo bash scripts/restore.sh <tarball>` (stops, restores DB +
  secrets + keys, starts).
- The DB lives on a **host bind mount `/opt/cast/data`** (not a named volume) so the
  backup reads it directly.
- **Off-box (TODO for true DR):** these backups sit on the VM — copy them
  **encrypted** to a second location (rclone/scp to cloud or another host).
  Destination TBD.

## Local development
`pnpm dev` runs web (Vite HMR) + api (tsx watch) natively — the fast loop; no
Docker needed locally (deploys build on the VM). One prerequisite: `better-sqlite3`
is a native module, so the dev machine needs a C++ toolchain —
`sudo apt-get install -y build-essential` (a one-time, machine-wide install; the
Docker image already includes the build deps). Symptom if missing: a `node-gyp`
failure at `pnpm install`.

## First-time bring-up (checklist)
1. `sudo mkdir -p /opt/cast && sudo chown $USER /opt/cast`
2. clone the repo (deploy key) into `/opt/cast/app`
3. create `components/api/.env` (`CAST_SECRET_KEY` — CW/aisstream/TrackingMore credentials live in the encrypted store, entered via the Integrations page after first bring-up, not env vars)
4. `bash scripts/setup-tls.sh` (self-signed now)
5. `docker compose up -d --build`
6. install the systemd auto-update timer + `unattended-upgrades`
7. later: real acme-dns cert once the public `_acme-challenge` CNAME + acme-dns account exist
