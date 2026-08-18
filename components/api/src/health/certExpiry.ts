/**
 * TLS certificate expiry probe (INIT-0016 follow-on, 2026-08-18). A real TLS
 * handshake to `web:443` over the internal Docker bridge (container-to-
 * container, same pattern as `internalWebUrl` — see config.ts) — NOT a file
 * read. certbot hardens `/etc/letsencrypt/archive/<domain>` to `0700
 * root:root`, so an unprivileged reader can't resolve the `live/` symlink
 * into it (verified live on trt-cast-01); a handshake sidesteps that
 * entirely and reads the SAME cert nginx is actually serving, which also
 * catches a cert/config mismatch a file read never would.
 * Thresholds: certbot renews automatically ~30 days before expiry, so
 * anything inside that window without having renewed means renewal is
 * genuinely stuck, not just "due soon" — danger under 7 days (real risk of
 * an expired cert), warn under 21 days (should have renewed by now).
 */
import { connect } from "tls";
import { config } from "../config";

export interface Probe { state: "ok" | "warn" | "down" | "idle"; detail: string; }

export function getTlsExpiryProbe(): Promise<Probe> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (probe: Probe) => {
      if (settled) return;
      settled = true;
      resolve(probe);
    };

    const socket = connect(
      { host: config.tlsProbeHost, port: 443, servername: config.tlsDomain, rejectUnauthorized: false, timeout: 5000 },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          finish({ state: "warn", detail: `No certificate returned by ${config.tlsProbeHost}:443` });
          return;
        }
        const validTo = new Date(cert.valid_to);
        const daysLeft = (validTo.getTime() - Date.now()) / 86_400_000;
        const state = daysLeft < 7 ? "down" : daysLeft < 21 ? "warn" : "ok";
        finish({ state, detail: `${config.tlsDomain} — expires ${validTo.toISOString().slice(0, 10)} (${Math.floor(daysLeft)}d left)` });
      },
    );
    socket.on("error", (e) => finish({ state: "warn", detail: `TLS probe to ${config.tlsProbeHost}:443 failed — ${e.message}` }));
    socket.on("timeout", () => {
      socket.destroy();
      finish({ state: "warn", detail: `TLS probe to ${config.tlsProbeHost}:443 timed out` });
    });
  });
}
