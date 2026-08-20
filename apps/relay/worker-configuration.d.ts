interface Env {
  WORKSPACES: DurableObjectNamespace;
  ACCOUNTS: DurableObjectNamespace;
  CONVERSATIONS: DurableObjectNamespace;
  AGENTS: DurableObjectNamespace;
  METRICS: DurableObjectNamespace;
  IDENTITIES: DurableObjectNamespace;
  ARTIFACTS: R2Bucket;
  RELAY_DEPLOYMENT: "chief-cloud" | "cloudflare-byoc";
  ACCOUNT_IDENTITY_MODE: "chief-account" | "key-native";
  AUTH_ISSUER: string;
  AUTH_JWKS_URL: string;
  RELAY_PUBLIC_URL?: string;
  BOOTSTRAP_TOKEN_SHA256: string;
}
