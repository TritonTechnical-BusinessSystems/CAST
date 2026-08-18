/**
 * Server configuration from the environment. Secrets are server-side only
 * (knowledge/decisions/0002). See .env.example.
 */
import "dotenv/config";
import { getSetting, setSetting } from "./store/secretStore";

const env = process.env;

/** The dev-only JWT fallback. Refused at startup in production (see below). */
const DEV_JWT_FALLBACK = "dev-insecure-secret";

export const config = {
  port: Number(env.CAST_API_PORT ?? 3001),
  nodeEnv: env.NODE_ENV ?? "development",
  isProd: (env.NODE_ENV ?? "development") === "production",

  /**
   * Secret for signing the JWT session cookie. MUST be set in production.
   * `||` not `??`: an empty-string env value (a blank line in `.env`) must
   * also fall back — `??` only catches null/undefined and previously let an
   * empty secret through, which crashed the whole process on first login
   * (jwt.sign throws synchronously inside an async handler → unhandled
   * rejection → Node terminates by default).
   */
  jwtSecret: env.CAST_JWT_SECRET || DEV_JWT_FALLBACK,
  jwtExpiresIn: env.CAST_JWT_EXPIRES_IN ?? "8h",

  /**
   * Read-only docker-socket-proxy (System Health container inventory,
   * INIT-0016) — never the raw Docker socket from within this process.
   */
  dockerProxyUrl: env.CAST_DOCKER_PROXY_URL ?? "http://docker-proxy:2375",

  /** Active Directory (LDAPS). Mechanism still open — INIT-0008. */
  ldapUrl: env.CAST_LDAP_URL ?? "",
  ldapBaseDN: env.CAST_LDAP_BASE_DN ?? "",
  ldapBindDN: env.CAST_LDAP_BIND_DN ?? "",
  ldapBindPassword: env.CAST_LDAP_BIND_PASSWORD ?? "",
  /** DN of the "CAST Users" group — membership REQUIRED to sign in. */
  ldapAllowedGroupDN: env.CAST_LDAP_ALLOWED_GROUP_DN ?? "",

  /**
   * Boot-time seed for how often the AIS-monitor Tier 1/2 split recomputes
   * (INIT-0012 §3.6) — cheap (a handful of bulk CW queries, not per-vessel),
   * so this can run often. Overridden at runtime by
   * setTierRefreshIntervalMinutes() below (same env-seed-then-settings-win
   * precedent as isCwWritesEnabled) so ops can retune it without a redeploy.
   * Vessel Site reconciliation runs on this same cadence now — see
   * reconcileVesselSites() in routes/tracking.ts.
   */
  tierRefreshMinutesDefault: Number(env.CAST_TRACKING_REFRESH_MINUTES ?? 5),

  /**
   * How many days a Vessel Site write keeps presuming/distrusting a stale
   * status before giving up and reverting to a bare "Vessel" (confidence.ts,
   * INIT-0012, decided 2026-08-17 — user asked for CAST's own recommendation
   * on the exact number). 90 days: generous enough to cover a genuinely long
   * refit without falsely reverting (the whole point of the 🔵 tier is that a
   * silent, stationary vessel is still almost certainly there), short enough
   * that a vessel that's been sold, renamed, or gone permanently dark doesn't
   * display a year-old ghost status forever. Overridden at runtime by
   * setVesselStatusFallbackDays() below (same env-seed-then-settings-win
   * precedent as tierRefreshMinutesDefault). A malformed env value silently
   * falling through to NaN here would fail OPEN, not closed — `age > NaN`
   * is always false, so a vessel would never expire and could show a
   * confident-looking guess forever — so this validates rather than trusts
   * `Number()`'s coercion (flagged in the v0.11.0 security review).
   */
  vesselStatusFallbackDaysDefault: (() => {
    const n = Number(env.CAST_VESSEL_STATUS_FALLBACK_DAYS);
    return Number.isFinite(n) && n > 0 ? n : 90;
  })(),

  /**
   * aisstream.io — AIS data source for Vessel Location Updating (INIT-0012).
   * WebSocket API; the key is a server-side secret. Docs + architecture:
   * knowledge/architecture/vessel-location-updating-aisstream.md.
   */
  aisstreamWsUrl: env.CAST_AISSTREAM_WS_URL ?? "wss://stream.aisstream.io/v0/stream",
  aisstreamApiKey: env.CAST_AISSTREAM_API_KEY ?? "",

  /**
   * ConnectWise PSA (Manage) REST API — INIT-0002 / 0012 / 0014. CAST's
   * credentialed CW read+write path; creds server-side only (decisions/0002).
   * Pattern mirrors LogisticsCoordinator's live integration —
   * knowledge/architecture/connectwise-api-integration.md.
   */
  cwBaseUrl: env.CW_BASE_URL ?? "https://na.myconnectwise.net/v4_6_release/apis/3.0",
  cwCompany: env.CW_COMPANY ?? "",
  cwPublicKey: env.CW_PUBLIC_KEY ?? "",
  cwPrivateKey: env.CW_PRIVATE_KEY ?? "",
  cwClientId: env.CW_CLIENT_ID ?? "",
  /** Company custom-field captions holding the vessel IMO / MMSI (INIT-0014). */
  cwImoFieldCaption: env.CW_IMO_FIELD_CAPTION ?? "Vessel IMO",
  cwMmsiFieldCaption: env.CW_MMSI_FIELD_CAPTION ?? "Vessel MMSI",
  /** Site custom-field caption holding the confidence-tiered write's timestamp (user-created 2026-08-17, a "Text" type field on the Site, not the Company). */
  cwLastAisUpdateFieldCaption: env.CW_LAST_AIS_UPDATE_FIELD_CAPTION ?? "Last AIS Data Update",
  /** CW company status that further scopes tracking (optional; INIT-0015). */
  cwTrackedStatus: env.CW_TRACKED_STATUS ?? "",
  /**
   * The CW **Market** that identifies a vessel company — a vessel is ANY company
   * whose Market contains this, regardless of IMO/MMSI (user rule 2026-07-23).
   * Matched with `contains` so the "🛳️ Yacht" emoji prefix is handled.
   */
  cwVesselMarket: env.CW_VESSEL_MARKET ?? "Yacht",
  /**
   * HARD SAFETY GATE boot default: all ConnectWise *writes* are refused unless
   * this resolves true. Default off. This env value is only the SEED for a
   * fresh install — once toggled in-app (isCwWritesEnabled/setCwWritesEnabled
   * below), the stored value in the settings DB takes over as the source of
   * truth, so ops can flip it from the UI without a redeploy. Reads are
   * unaffected either way.
   */
  cwWritesEnabled: (env.CW_WRITES_ENABLED ?? "false").toLowerCase() === "true",

  /**
   * TrackingMore — shipment tracking data source (INIT-0018). REST API, the
   * key is a server-side secret sent as the `Tracking-Api-Key` header.
   * Docs: https://www.trackingmore.com/docs/trackingmore/.
   */
  trackingmoreBaseUrl: env.CAST_TRACKINGMORE_BASE_URL ?? "https://api.trackingmore.com/v4",
  trackingmoreApiKey: env.CAST_TRACKINGMORE_API_KEY ?? "",

  /**
   * Where Playwright (PDF generation, INIT-0026 Phase 3) reaches the live
   * SPA from *inside* this process — mirrors LC's own `pdf_service.py`
   * pattern exactly, right down to the port: `nginx.conf` has a dedicated
   * internal-only `listen 8080` block (not published to the host) precisely
   * because the public port 443 block's certificate is issued for
   * `cast.tritontechnical.com`, not the internal Docker DNS name `web`, and
   * port 80 would just redirect into that same certificate mismatch. Override
   * for local dev, where there's no `web` container — point it at the Vite
   * dev server (`http://localhost:5173`) instead.
   */
  internalWebUrl: env.CAST_INTERNAL_WEB_URL ?? "http://web:8080",

  /**
   * System Health infra probes (INIT-0016 follow-on, 2026-08-18) — TLS cert
   * expiry + backup freshness.
   *
   * TLS: NOT a file read. Verified live against trt-cast-01: certbot hardens
   * `/etc/letsencrypt/archive/<domain>` to `0700 root:root` — the `live/`
   * symlink `fullchain.pem` points INTO that directory, so an unprivileged
   * reader (`castapi`, uid 10001) gets EACCES resolving it despite the
   * symlink itself being world-readable. Mounting `/etc/letsencrypt` into
   * `api` would therefore ship a probe that never actually works. Instead
   * `health/certExpiry.ts` does a real TLS handshake to `web:443` (the SAME
   * cert nginx actually serves, over the container-to-container bridge —
   * no new mount, no permission dependency, and it catches a cert/config
   * mismatch a file read never would).
   *
   * Backups: still a file read — verified live that `/opt/cast/backups` is
   * `0755 root:root` (world-searchable/listable) while each tarball inside
   * is `0600 root:root` (owner-read-only). `stat()` only needs directory
   * search permission, not read access to the file itself, so `castapi` can
   * see name/size/mtime but never open a tarball's contents — this one
   * actually works as designed.
   */
  tlsDomain: env.CAST_TLS_DOMAIN ?? "cast.tritontechnical.com",
  tlsProbeHost: env.CAST_TLS_PROBE_HOST ?? "web",
  backupDir: env.CAST_BACKUP_DIR ?? "/opt/cast/backups",
} as const;

// Fail fast rather than silently signing sessions with a public default secret —
// an unset CAST_JWT_SECRET in production would let anyone forge an admin cookie.
if (config.isProd) {
  if (config.jwtSecret === DEV_JWT_FALLBACK) {
    throw new Error("CAST_JWT_SECRET is required in production — refusing to start with the insecure default.");
  }
  if (config.jwtSecret.length < 32) {
    throw new Error("CAST_JWT_SECRET must be at least 32 characters in production.");
  }
}

export function adConfigured(): boolean {
  return Boolean(config.ldapUrl && config.ldapBaseDN && config.ldapAllowedGroupDN);
}

export function aisstreamConfigured(): boolean {
  return Boolean(config.aisstreamApiKey);
}

export function cwConfigured(): boolean {
  return Boolean(config.cwCompany && config.cwPublicKey && config.cwPrivateKey && config.cwClientId);
}

export function trackingmoreConfigured(): boolean {
  return Boolean(config.trackingmoreApiKey);
}

const CW_WRITES_SETTING_KEY = "cwWritesEnabled";

/** Live safety-gate check — the in-app toggle if set, else the env boot default. */
export function isCwWritesEnabled(): boolean {
  const stored = getSetting<boolean>(CW_WRITES_SETTING_KEY);
  return stored !== undefined ? stored : config.cwWritesEnabled;
}

export function setCwWritesEnabled(enabled: boolean): void {
  setSetting(CW_WRITES_SETTING_KEY, enabled);
}

const TIER_REFRESH_MINUTES_KEY = "tracking.refreshIntervalMinutes";

/** Live cadence check — the in-app value if set, else the env boot default. */
export function tierRefreshMinutes(): number {
  const stored = getSetting<number>(TIER_REFRESH_MINUTES_KEY);
  return stored && stored > 0 ? stored : config.tierRefreshMinutesDefault;
}

export function setTierRefreshMinutes(minutes: number): void {
  if (!(minutes > 0)) throw new Error("Refresh interval must be a positive number of minutes");
  setSetting(TIER_REFRESH_MINUTES_KEY, minutes);
}

const VESSEL_STATUS_FALLBACK_DAYS_KEY = "tracking.vesselStatusFallbackDays";

/** Live check — the in-app value if set, else the env boot default. */
export function vesselStatusFallbackDays(): number {
  const stored = getSetting<number>(VESSEL_STATUS_FALLBACK_DAYS_KEY);
  return stored && stored > 0 ? stored : config.vesselStatusFallbackDaysDefault;
}

export function setVesselStatusFallbackDays(days: number): void {
  if (!(days > 0)) throw new Error("Fallback duration must be a positive number of days");
  setSetting(VESSEL_STATUS_FALLBACK_DAYS_KEY, days);
}

const VESSEL_SITE_WRITE_ALLOWLIST_KEY = "tracking.vesselSiteWriteAllowlist";

export type VesselSiteWriteAllowlist = "all" | string[];

/**
 * A second, narrower gate in front of Vessel Site writes specifically — on
 * top of, not instead of, `isCwWritesEnabled()`. `cwWritesEnabled` is shared
 * across every CW write CAST makes (vessel identity reconciliation,
 * Logistics document posting, ticket status) — flipping it on to start
 * Vessel Site writes would also silently remove the safety interlock on
 * those other, separately-gated features. This allowlist exists so the
 * *first* real production writes can be scoped to a handful of MMSIs the
 * user picks and watches, rather than every Tier 1/2 vessel at once on the
 * very next 5-minute cycle (user, 2026-08-18: "gate the initial push so we
 * control it and can test with a few at a time"). Default (unset) is an
 * empty list — writes to NOBODY until explicitly opted in, the safe
 * direction for a controlled rollout. `"all"` is the explicit graduation
 * sentinel once testing is done, so "no restriction" has to be a deliberate
 * choice, never an accidental unset value.
 */
export function vesselSiteWriteAllowlist(): VesselSiteWriteAllowlist {
  const stored = getSetting<VesselSiteWriteAllowlist>(VESSEL_SITE_WRITE_ALLOWLIST_KEY);
  return stored ?? [];
}

export function setVesselSiteWriteAllowlist(value: VesselSiteWriteAllowlist): void {
  if (value !== "all" && !Array.isArray(value)) {
    throw new Error('Allowlist must be "all" or an array of MMSIs');
  }
  setSetting(VESSEL_SITE_WRITE_ALLOWLIST_KEY, value);
}

export function isVesselSiteWriteAllowed(mmsi: string): boolean {
  const allowlist = vesselSiteWriteAllowlist();
  return allowlist === "all" || allowlist.includes(mmsi);
}
