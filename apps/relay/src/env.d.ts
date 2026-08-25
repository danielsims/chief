/** Secrets are configured out-of-band and therefore are not emitted by
 * `wrangler types`; keep their runtime contract alongside the Worker source. */
interface Env {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_EMAIL_API_TOKEN: string;
  EMAIL_FROM_ADDRESS: string;
  EMAIL_FROM_NAME: string;
  /** Master key for workspace-scoped encrypted secrets. Required. */
  RELAY_SECRET_KEY: string;
}
