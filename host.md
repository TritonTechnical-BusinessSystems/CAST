# CAST Deployment Host

Snapshot of the live server this app runs on, gathered directly via SSH (not
inferred). Update by re-running the commands below rather than editing
numbers by hand. See `knowledge/architecture/cast-web-app-vm-provisioning.md`
for connection details (IP, user, SSH key, network config) — this file is the
live-usage companion to that provisioning record, same pairing as
LogisticsCoordinator's `host.md` alongside its `CLAUDE.md`.

## Identity

- **Hostname:** trt-cast-01
- **Virtualization:** VMware (VMware7,1 hardware model) — this is a VM, not
  bare metal
- **OS:** Ubuntu 24.04.4 LTS
- **Kernel:** Linux 6.8.0-136-generic (x86_64)
- **Uptime at snapshot:** 26 days, load average ~0.04 (idle)

## CPU

- **Model:** Intel Xeon Gold 5218 @ 2.30GHz — same CPU model as LC's host
  (`trt-app-05`), consistent with both being VMs on the same underlying
  VMware cluster
- **Allocation:** 2 vCPUs (2 sockets × 1 core × 1 thread — a VM CPU
  allocation shape, not a real 2-socket server)
- Effectively idle at snapshot time (load average 0.04/0.03/0.00)

## Memory

- **RAM:** 3.8 GiB total — small, matching LC's host exactly. 911Mi used,
  165Mi free, 3.1Gi buff/cache (reclaimable), 2.9Gi available — most of the
  "used" figure is reclaimable cache, not real application pressure, same
  pattern as LC's snapshot.
- **Swap:** 3.8 GiB, only 1.0Mi in use — memory pressure is not currently an
  issue, but (as with LC) there's very little headroom if the workload grows.

## Storage

- **Root disk:** 37 GB total on `/` (`/dev/mapper/ubuntu-vg-ubuntu-lv`) —
  now matches LC's 37G partition almost exactly.
  - `/` — 37G, 14G used / 21G available (**41% used**)
  - `/boot` — 2.0G, 200M used (11%)
  - `/boot/efi` — 1.1G, mostly free
- **Grown 2026-08-13** from an original 19G/82%-used partition. The
  underlying VMware virtual disk was already 40G — the LVM volume group had
  18.47G of free space provisioned but never allocated to the root logical
  volume. Pure LVM + online `resize2fs` growth (`lvextend -l +100%FREE` then
  `resize2fs`), no VMware-level disk resize, no reboot, no downtime:
  `sudo lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv && sudo resize2fs /dev/mapper/ubuntu--vg-ubuntu--lv`.

## GPU

- VMware SVGA II Adapter (virtual display device only) — no real GPU, no
  hardware acceleration. Not currently relevant to CAST's own workload (no
  Chromium/Playwright rendering runs on this host today), but matters
  directly if `INIT-0026`'s LC merge lands PDF generation here — LC's own
  Playwright/Chromium rendering already runs CPU-only on identical hardware,
  so no GPU-acceleration option would open up by moving it here either.

## Network

- **Primary interface:** `ens192`, 10.20.30.231/24 (internal VMware network,
  static — see `cast-web-app-vm-provisioning.md` §2)
- **Tailscale:** `tailscale0`, 100.79.102.62 — the stable management path.
- **Docker bridges:** `docker0` (172.17.0.1/16, unused) and
  `br-99119c0ef18d` (172.18.0.1/16, the `app_internal` Compose network the
  three containers sit on), plus per-container veth pairs.

## Docker

- **Engine:** v29.6.2
- **Running containers** (`app_internal` Compose network), all healthy at
  snapshot time:

  | Container | Image | Status | Live CPU | Live Mem |
  |---|---|---|---|---|
  | `cast-web` | `cast-web:latest` | Up 3 days | 0.00% | 3.7 MiB |
  | `cast-api` | `cast-api:latest` | Up 3 days (healthy) | 0.30% | 165.6 MiB |
  | `cast-docker-proxy` | `tecnativa/docker-socket-proxy:latest` | Up 6 days | 0.00% | 17.1 MiB |

  `cast-api` is running noticeably hotter than LC's equivalent backend
  container (165.6 MiB vs. LC's 66 MiB) even at idle — consistent with it
  holding more live state today (the `INIT-0012` AIS WebSocket listener,
  active DB connections) than LC's request-only FastAPI process.

- **Images:**
  - `cast-api:latest` — 517 MB — **no Playwright/Chromium bundled today**
    (CAST does no PDF rendering yet). For comparison, LC's equivalent
    backend image is 2.2 GB specifically *because* it bundles Chromium —
    worth expecting `cast-api` (or a future `cast-worker`) to grow toward
    that same size once `INIT-0026`'s PDF-generation piece lands here.
  - `cast-web:latest` — 74 MB (nginx:alpine + static build output)
  - `tecnativa/docker-socket-proxy:latest` — 65.8 MB
  - `curlimages/curl:latest` — 35.3 MB (healthcheck tooling)

## Process count

- 231 processes at snapshot time — a normal, lightly-loaded single-purpose
  app VM, same shape as LC's host.

## Notes

- This file is a point-in-time snapshot (generated 2026-08-13). Load,
  memory-available, and disk-used figures will drift — re-run the
  underlying commands over SSH (`hostnamectl`, `lscpu`, `free -h`, `df -h`,
  `docker ps` / `docker stats --no-stream`) for current numbers rather than
  trusting this file indefinitely.
- **Direct comparison to LC's `host.md` (`INIT-0026`'s combined-resource
  question):** both hosts are 2 vCPU / 3.8 GiB RAM VMs on the same VMware
  cluster (identical CPU model) — a genuinely even split, not one dominant
  host absorbing a trivial one. **Naive combined total: 4 vCPU / ~7.6 GB
  RAM.** Disk was the one place they differed meaningfully (82% used on a
  19G partition here vs. LC's 59% on 37G) — **resolved 2026-08-13**, this
  host's root partition grown to 37G/41% used, now matching LC's almost
  exactly. Both hosts now equally positioned for the combined-target
  question; RAM (3.8 GiB each, ~7.6 GB combined) is the tighter resource of
  the two going forward, not disk.
