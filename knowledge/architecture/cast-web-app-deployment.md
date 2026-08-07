---
status: active
read-when: Deploying CAST to trt-cast-01, or changing container topology, nginx, TLS, or the auto-update mechanism.
related: [cast-web-app-vm-provisioning.md, connectwise-api-integration.md, ../decisions/0006-web-app-stack-vite-react-express.md]
updated: 2026-08-07
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
- **web** (built from `components/web/Dockerfile`, final stage `nginx:1.27-alpine`)
  — serves the SPA + proxies `/api` → `api:3001`, terminates TLS, publishes
  80+443, bind-mounts `/etc/letsencrypt:ro`. `depends_on: api` (`service_healthy`).
All `restart: unless-stopped`. Secrets via `components/api/.env` (git-ignored).

## nginx (`components/web/nginx.conf`)
`80 → 301 https`. `443 ssl` serves the SPA (try_files fallback, immutable asset
cache, no-store `index.html`) + proxies `/api` with a runtime `resolver` so nginx
starts even if `api` is briefly down.

## TLS — acme-dns DNS-01 (LC's exact method)
Real certs need only **outbound** (available here). Interim: **self-signed** via
`scripts/setup-tls.sh`; real-cert steps are in that script and `vm-provisioning §7`.
Renewal: `certbot.timer`; a deploy-hook reloads nginx.

## Deploy
- App dir on VM: `/opt/cast/app` (git clone via the read-only deploy key).
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
