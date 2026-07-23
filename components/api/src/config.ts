/**
 * Server configuration from the environment. Secrets are server-side only
 * (knowledge/decisions/0002). See .env.example.
 */
import "dotenv/config";

const env = process.env;

export const config = {
  port: Number(env.CAST_API_PORT ?? 3001),
  nodeEnv: env.NODE_ENV ?? "development",
  isProd: (env.NODE_ENV ?? "development") === "production",

  /** Secret for signing the JWT session cookie. MUST be set in production. */
  jwtSecret: env.CAST_JWT_SECRET ?? "dev-insecure-secret",
  jwtExpiresIn: env.CAST_JWT_EXPIRES_IN ?? "8h",

  /** Active Directory (LDAPS). Mechanism still open — INIT-0008. */
  ldapUrl: env.CAST_LDAP_URL ?? "",
  ldapBaseDN: env.CAST_LDAP_BASE_DN ?? "",
  ldapBindDN: env.CAST_LDAP_BIND_DN ?? "",
  ldapBindPassword: env.CAST_LDAP_BIND_PASSWORD ?? "",
  /** DN of the "CAST Users" group — membership REQUIRED to sign in. */
  ldapAllowedGroupDN: env.CAST_LDAP_ALLOWED_GROUP_DN ?? "",

  /** Cron expression for the vessel-location sync (INIT-0012). */
  vesselSyncCron: env.CAST_VESSEL_SYNC_CRON ?? "0 * * * *",

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
  /** CW company status that scopes a "tracked" vessel-client (INIT-0012). */
  cwTrackedStatus: env.CW_TRACKED_STATUS ?? "",
} as const;

export function adConfigured(): boolean {
  return Boolean(config.ldapUrl && config.ldapBaseDN && config.ldapAllowedGroupDN);
}

export function aisstreamConfigured(): boolean {
  return Boolean(config.aisstreamApiKey);
}

export function cwConfigured(): boolean {
  return Boolean(config.cwCompany && config.cwPublicKey && config.cwPrivateKey && config.cwClientId);
}
