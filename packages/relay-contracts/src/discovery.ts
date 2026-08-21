import { z } from "zod";

export const relayCapabilitySchema = z.enum([
  "workspaces",
  "conversations",
  "durable-agents",
  "projects",
  "artifacts",
  "logs",
]);

export const relayDiscoverySchema = z.object({
  protocol: z.literal("chief-relay"),
  protocolVersion: z.literal(1),
  deployment: z.enum([
    "chief-cloud",
    "cloudflare-byoc",
    "self-hosted",
    "local",
  ]),
  apiBaseUrl: z.url(),
  websocketUrl: z.url(),
  openApiUrl: z.url(),
  capabilities: z.array(relayCapabilitySchema),
  authentication: z.object({
    scheme: z.literal("NIP-98"),
    signingAlgorithm: z.literal("secp256k1-schnorr"),
    accountIssuer: z.url(),
  }),
});

export type RelayDiscovery = z.infer<typeof relayDiscoverySchema>;
