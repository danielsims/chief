/** Secrets are configured out-of-band and therefore are not emitted by
 * `wrangler types`; keep their runtime contract alongside the Worker source. */
interface Env {
  /** Stable identifier for this relay installation. */
  RELAY_ID: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_EMAIL_API_TOKEN: string;
  EMAIL_FROM_ADDRESS: string;
  EMAIL_FROM_NAME: string;
  /** Master key for workspace-scoped encrypted secrets. Required. */
  RELAY_SECRET_KEY: string;
  /** Publicly reachable OTLP/HTTP base URL when full telemetry is enabled. */
  RELAY_OTLP_ENDPOINT?: string;
  /** Optional Authorization header sent to the OTLP endpoint. */
  RELAY_OTLP_AUTHORIZATION?: string;
  /** Public URL of an independently deployed Chief computer host. */
  COMPUTER_BASE_URL?: string;
  /** Shared signing key used only to mint short-lived computer leases. */
  COMPUTER_AUTH_SECRET?: string;
}
