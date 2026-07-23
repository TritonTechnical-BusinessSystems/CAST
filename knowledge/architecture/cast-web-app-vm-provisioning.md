---
status: active
read-when: Deploying to, accessing, or changing the network/host config of the CAST web app VM (trt-cast-01) — or planning where the scheduled data-sync services run.
related: [cast-web-app-mockup.md, ../decisions/0004-monorepo-with-artifacts-only-public-surface.md]
updated: 2026-07-22
---

# CAST web app VM — provisioning & access record

The host the CAST web app (`INIT-0008`) is deployed to. Docker on an internal
Linux VM, per that initiative's settled hosting decision. This file records
what's real on the box so it isn't rediscovered from scratch each session.

> Contains internal hostnames/IPs. This is a private repo (`../decisions/0004-monorepo-with-artifacts-only-public-surface.md`) — fine to record here; never publish it.

## 1. Identity & sizing

| Field | Value |
|---|---|
| Hostname | `trt-cast-01` |
| Platform | VMware VM, Ubuntu 24.04.4 LTS (Server, minimized) |
| vCPU / RAM | 2 vCPU / 4 GB (`nproc`=2, ~3.8 GiB usable) |
| Primary admin account | `tritonadmin` (local Linux account, sudo-capable) |
| Intended role | Docker host for the CAST web app; likely also the scheduled data-sync services (`INIT-0002`/`INIT-0012`) unless they get their own host |

Sizing rationale: 2 vCPU / 4 GB balances a light internal web app plus
occasional scheduled sync jobs; RAM is the likelier ceiling to grow first,
not CPU. Resize on the hypervisor if sustained pressure appears.

## 2. Networking — static (applied 2026-07-22)

**Current (working): static, `10.20.30.231/24`.** Applied 2026-07-22 once the
VLAN-egress blocker (see §4) was fixed by the network team. Internet egress and
`triton.local` DNS both verified live at cutover (HTTP reachable in ~57 ms; the
domain resolves to the DCs `10.20.30.208`/`.209`/`10.50.49.200`/`10.20.40.200`).
Netplan file `/etc/netplan/50-cloud-init.yaml`:

```yaml
network:
  version: 2
  ethernets:
    ens192:
      dhcp4: false
      addresses: [10.20.30.231/24]
      routes:
        - to: default
          via: 10.20.30.1
      nameservers:
        addresses: [10.20.30.208, 10.20.30.209]
        search: [triton.local]
```

- `.208`/`.209` are the DNS servers (the AD domain controllers — the right
  nameservers for CAST's AD login, `INIT-0008`; confirmed resolving `triton.local`).
- `triton.local` is the AD search domain.
- Interface is `ens192` (VMware). Cloud-init network management was disabled
  (`/etc/cloud/cloud.cfg.d/99-disable-network-config.cfg`) so netplan is the
  source of truth.

**Prior (fallback reference): DHCP** — `10.7.11.202/24`, gw/DNS `10.7.11.1`, a
network with working egress. A backup of that DHCP netplan is kept on the box at
`/root/netplan-backup-dhcp.yaml` if a revert is ever needed.

**Cutover method (for future remote network changes):** the static apply was
done from `forge` over Tailscale with a *dead-man's-switch* — a detached
`systemd-run --on-active=300` timer that would restore the DHCP backup and
`netplan apply` if not cancelled within 5 minutes, so a lost session self-heals
without needing the VMware console. The apply itself was scheduled detached
(`systemd-run --on-active=3`) so the SSH drop at IP-flip couldn't abort it, and
it logged the post-cutover state to `/root/static-cutover.log`. Timer cancelled
once access + egress were confirmed. Reuse this pattern for any remote change
that can sever the management path.

## 3. Management access

- **Tailscale** is installed and is the stable, LAN-independent management
  path: `100.79.102.62` (tailnet MagicDNS domain `tailc43edc.ts.net`,
  device name `trt-cast-01`). Survives LAN IP changes — the reason the
  static-IP cutover is now low-risk from a "don't lose access" standpoint,
  *as long as the VM's network has the egress Tailscale itself needs*.
- **SSH:** key-based. `tritonadmin`'s `~/.ssh/authorized_keys` holds the
  user's Windows key and the dev machine `forge`'s key
  (`matt@tritonlaptop`), so the repo's tooling can drive the box directly.
- **`tritonadmin` has passwordless sudo** via
  `/etc/sudoers.d/tritonadmin-nopasswd` — **deliberately temporary**, kept
  open only during active build-out for unattended automation. Remove it
  (`sudo rm /etc/sudoers.d/tritonadmin-nopasswd`) before the box is
  considered production. Mirror of CAST's own "AD primary, local break-glass"
  security posture: convenient during setup, hardened for operation.
- Always retain **VMware console** as the out-of-band fallback for when a
  network change makes both SSH and Tailscale unreachable.

## 4. Resolved — VLAN egress (was a blocker)

The static VLAN (`10.20.30.0/24`) originally had **no outbound internet**:
local subnet + DNS worked, but all outbound TCP to the internet timed out
(gateway `10.20.30.1` routing/proxy question). This was a network/firewall
matter, not a VM config issue — the netplan config was correct all along.

**Fixed 2026-07-22** (routing corrected by the network team). Verified live at
the static cutover: outbound HTTPS reachable in ~57 ms and Docker/apt egress
paths open. This unblocked moving the VM to its permanent static address (§2),
which the host needs for:
- Docker image pulls / `apt` updates, and
- the **Vessel Location Updating** marine-traffic API calls (`INIT-0012`).

## 5. Installed stack (as of 2026-07-19)

- Fully apt-updated Ubuntu 24.04.4.
- Baseline tooling: `git`, `nano`, `dnsutils` (`dig`), `iputils-ping`, `curl`,
  `ca-certificates`, `gnupg`.
- **Docker Engine 29.6.2** + **Compose plugin v5.3.1**, from Docker's
  official apt repo (not the distro `docker.io` package). Service enabled on
  boot. `tritonadmin` is in the `docker` group. Verified working
  (`hello-world` pulled + ran).

## 6. Open items

- [x] Resolve the §4 egress blocker with the network team. *(Fixed 2026-07-22.)*
- [x] Apply the static config; point DNS at the DCs so AD auth (`INIT-0008`) can
      resolve `triton.local`. *(Done 2026-07-22 — `10.20.30.231/24`, §2;
      `triton.local` confirmed resolving to the DCs.)*
- [ ] Remove the temporary NOPASSWD sudo grant before production (§3).
- [ ] Consider disabling password SSH auth (key-only) once key access is
      proven for all who need it; consider Tailscale ACLs / Tailscale SSH as
      the access-control layer (ties to the "VPN-gated internal network"
      assumption in `../decisions/0004-monorepo-with-artifacts-only-public-surface.md`).
- [ ] Decide whether the scheduled data-sync services (`INIT-0002`/`INIT-0012`)
      share this VM or get their own.

## 7. TLS / certificates — mirror LogisticsCoordinator (recorded 2026-07-23)

Per user direction, CAST uses the **exact same cert method as LC** — verified by
inspecting the live LC host. It's the right fit because it needs only *outbound*
internet (which this VM has), never inbound, so `cast.tritontechnical.com` stays
private while still getting real Let's Encrypt certs.

**LC's method (source of truth):**
- **certbot** with the **`dns-acmedns`** authenticator (DNS-01 challenge solved via
  an acme-dns server), credentials at `/etc/letsencrypt/acmedns.ini`.
- Renewal is automatic via the **`certbot.timer`** systemd unit
  (`OnCalendar=*-*-* 00,12:00:00`, `Persistent=true`).
- nginx bind-mounts `/etc/letsencrypt:ro` and points at
  `/etc/letsencrypt/live/<domain>/{fullchain,privkey}.pem`.

**Replicate on `trt-cast-01`:**
1. `apt install certbot python3-certbot-dns-acmedns` (LC has `certbot` +
   `python3-certbot`; add the acme-dns plugin).
2. Register a **new** acme-dns account for `cast.tritontechnical.com` against the
   **same acme-dns server LC uses** (read the server URL from LC's
   `/etc/letsencrypt/acmedns.ini`); write CAST's own `/etc/letsencrypt/acmedns.ini`.
3. **Public DNS dependency:** add a CNAME `_acme-challenge.cast.tritontechnical.com`
   → the acme-dns fulfillment host, in the **public** `tritontechnical.com` zone.
   (Only this challenge record is public; the app's A record stays internal —
   the app is never publicly reachable.)
4. `certbot certonly -a dns-acmedns --dns-acmedns-credentials /etc/letsencrypt/acmedns.ini -d cast.tritontechnical.com`.
5. `certbot.timer` handles renewal; nginx reloads on renew.

**DONE 2026-07-23:** real acme-dns cert issued and live (Let's Encrypt, valid to
2026-10-21, auto-renewing via `certbot.timer` + a deploy-hook that reloads the web
container's nginx). acme-dns account registered at `auth.acme-dns.io`
(fulldomain `19de093c-059d-43a0-b2ad-262fa8933e0e.auth.acme-dns.io`); the public
CNAME `_acme-challenge.cast.tritontechnical.com` → that fulldomain is live. Plugin
`certbot-dns-acmedns` (pip). Account creds: `/etc/letsencrypt/acmedns.json` on the VM.

**Access DNS:** internal A record `cast.tritontechnical.com → 10.20.30.231`
**created 2026-07-23** (user).
