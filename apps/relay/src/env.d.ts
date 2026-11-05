/** Secrets are configured out-of-band and therefore are not emitted by
 * `wrangler types`; keep their runtime contract alongside the Worker source. */
interface Env {
  /** Stable identifier for this relay installation. */
  RELAY_ID: string;
  /** Self-hosted browser companion; these are already emitted by entrypoint.sh. */
  COMPUTER_BASE_URL?: string;
  COMPUTER_AUTH_SECRET?: string;
  BROWSER_BASE_URL?: string;
  BROWSER_AUTH_SECRET?: string;
  /** Optional Exa key; web search works without one at a lower rate limit. */
  EXA_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_EMAIL_API_TOKEN: string;
  EMAIL_FROM_ADDRESS: string;
  EMAIL_FROM_NAME: string;
  /** Explicit sender: "resend", "cloudflare", or "none". Auto-detected when
   * unset. */
  EMAIL_PROVIDER?: string;
  /** Resend API key, used when EMAIL_PROVIDER is "resend" or auto-detected. */
  RESEND_API_KEY?: string;
  /** Master key for workspace-scoped encrypted secrets. Required. */
  RELAY_SECRET_KEY: string;
  /**
   * The relay's own GitHub App. Optional: without it, a workspace owner
   * creates a private app for their workspace from Chief.
   */
  GITHUB_APP_ID?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
  /** Publicly reachable OTLP/HTTP base URL when full telemetry is enabled. */
  RELAY_OTLP_ENDPOINT?: string;
  /** Optional Authorization header sent to the OTLP endpoint. */
  RELAY_OTLP_AUTHORIZATION?: string;
  /** Git commit the relay was deployed from, reported as service.version. */
  RELAY_GIT_SHA?: string;
  /** Optional experiment label for telemetry; discovery keeps its deployment type. */
  RELAY_TELEMETRY_DEPLOYMENT?: string;
}
