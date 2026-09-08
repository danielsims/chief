import { relayDiscoverySchema } from "@chief/relay-contracts";

export function relayDiscovery(request: Request, url: URL, env: Env) {
  const origin = publicOrigin(request, url, env);
  return relayDiscoverySchema.parse({
    protocol: "relay",
    protocolVersion: 1,
    relayId: env.RELAY_ID,
    deployment: env.RELAY_DEPLOYMENT,
    apiBaseUrl: `${origin}/v1`,
    websocketUrl: `${origin.replace(/^http/u, "ws")}/v1/connect`,
    openApiUrl: `${origin}/v1/openapi.json`,
    capabilities: [
      "workspaces",
      "conversations",
      "durable-agents",
      "projects",
      "git",
      "artifacts",
      "logs",
    ],
    authentication: {
      scheme: "NIP-98",
      signingAlgorithm: "secp256k1-schnorr",
      accountIssuer: `${env.AUTH_BASE_URL.replace(/\/$/u, "")}/api/auth`,
      methods: [
        "email-password",
        ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
          ? (["google"] as const)
          : []),
      ],
    },
  });
}

export function publicOrigin(request: Request, url: URL, env: Env) {
  if (env.RELAY_PUBLIC_URL) return env.RELAY_PUBLIC_URL.replace(/\/$/u, "");
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (forwardedProtocol === "https" && url.protocol === "http:") {
    const forwarded = new URL(url);
    forwarded.protocol = "https:";
    return forwarded.origin;
  }
  return url.origin;
}
