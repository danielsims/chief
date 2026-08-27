declare module "cloudflare:workers" {
  interface ProvidedEnv {
    WORKSPACES: DurableObjectNamespace;
    ACCOUNTS: DurableObjectNamespace;
    CONVERSATIONS: DurableObjectNamespace;
    AGENTS: DurableObjectNamespace;
    METRICS: DurableObjectNamespace;
    ARTIFACTS: R2Bucket;
    RELAY_DEPLOYMENT:
      "chief-cloud" | "cloudflare-byoc" | "self-hosted" | "local";
    RELAY_ID: string;
    RELAY_PUBLIC_URL?: string;
    BOOTSTRAP_TOKEN_SHA256: string;
    OPENCODE_API_KEY?: string;
  }
}
