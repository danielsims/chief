interface Env {
  WORKSPACES: DurableObjectNamespace;
  ACCOUNTS: DurableObjectNamespace;
  CONVERSATIONS: DurableObjectNamespace;
  AGENTS: DurableObjectNamespace;
  ARTIFACTS: R2Bucket;
  RELAY_DEPLOYMENT: "chief-cloud" | "cloudflare-byoc";
  RELAY_PUBLIC_URL?: string;
  AUTH_ISSUER: string;
  AUTH_AUDIENCE: string;
  AUTH_JWKS_URL: string;
  BOOTSTRAP_TOKEN_SHA256: string;
}
