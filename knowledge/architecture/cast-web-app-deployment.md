---
status: active
read-when: Deploying CAST to trt-cast-01, or changing container topology, nginx, TLS, or the auto-update mechanism.
related: [cast-web-app-vm-provisioning.md, connectwise-api-integration.md, ../decisions/0006-web-app-stack-vite-react-express.md]
updated: 2026-08-14
---

# CAST web app — deployment

Docker on `trt-cast-01` (internal-only: outbound internet yes, inbound no). Pattern
mirrors Logistics Coordinator. **DEPLOYED 2026-07-23 — live at
`https://cast.tritontechnical.com`** with a real, auto-renewing Let's Encrypt cert
(acme-dns DNS-01) and the GA auto-update timer enabled. App dir `/opt/cast/app`.

## Topology (`docker-compose.yml`)
- **docker-proxy** (`tecnativa/docker-socket-proxy`) — read-only view of the Docker
  daemon for System Health's container inventory (`INIT-0016`). `api` talks to
  this, never the raw socket — only `CONTAINERS` (GET) is allow-listed, and it's
  never published to the host, only reachable from `api` on the internal network.
- **api** (`@cast/api`, Express via tsx, multi-stage build) — internal only;
  encrypted store persisted via a **host bind mount** `/opt/cast/data` →
  `/app/components/api/.data` (not a named volume — `scripts/backup.sh` reads it
  directly). Depends on `docker-proxy`.
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
3. create `components/api/.env` (CW + aisstream keys, `CAST_SECRET_KEY`, `CW_WRITES_ENABLED=false`)
4. `bash scripts/setup-tls.sh` (self-signed now)
5. `docker compose up -d --build`
6. install the systemd auto-update timer + `unattended-upgrades`
7. later: real acme-dns cert once the public `_acme-challenge` CNAME + acme-dns account exist
