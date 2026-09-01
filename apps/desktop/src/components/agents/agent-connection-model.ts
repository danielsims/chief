import type { RelayClient } from "@chief/relay-client";
import type {
  AgentDefinitionSource,
  WorkspaceAgentRuntime,
} from "@chief/relay-contracts";

import type { Provider } from "../../lib/providers";

export type AgentConnectionKind = "native" | "eve";

export type RelayRuntimeIdentity =
  { kind: "chief-cloud" } | { kind: "self-hosted"; name: string };

export function relayRuntimeIdentity(
  relayUrl: string,
  chiefCloudRelayUrl: string,
): RelayRuntimeIdentity {
  const relay = new URL(relayUrl);
  return relay.origin === new URL(chiefCloudRelayUrl).origin
    ? { kind: "chief-cloud" }
    : { kind: "self-hosted", name: relay.host };
}

export function suggestedVercelProjectName(
  agentName: string,
  existingProjectNames: readonly string[],
  collisionSuffix: string,
) {
  const baseName = projectSlug(agentName);
  if (!baseName) return "";
  const existingNames = new Set(
    existingProjectNames.map((name) => name.toLowerCase()),
  );
  return existingNames.has(baseName.toLowerCase())
    ? `${baseName.slice(0, Math.max(1, 63 - collisionSuffix.length))}-${collisionSuffix}`
    : baseName;
}

export function nativeProvidersForDeployment(
  deployment: "chief-cloud" | "on-device",
): readonly Provider[] {
  return deployment === "chief-cloud"
    ? ["remote", "opencode"]
    : ["opencode", "codex", "claude"];
}

function projectSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
}

export function externalAgentSourcePresentation(
  definition: AgentDefinitionSource,
  deployment: Extract<
    WorkspaceAgentRuntime,
    { kind: "external-channel" }
  >["deployment"],
) {
  return {
    repository:
      definition.repository.provider === "github"
        ? `${definition.repository.owner}/${definition.repository.name}`
        : `Chief Git · ${definition.repository.repositoryId}`,
    revision:
      definition.verification.status === "verified"
        ? `Verified at ${definition.verification.resolvedCommitSha.slice(0, 7)}`
        : "Project linked · revision pending verification",
    deployment:
      deployment.status === "attested"
        ? `Deployment attested at ${deployment.resolvedCommitSha.slice(0, 7)}`
        : "Deployment not attested",
  };
}

export function validateEveConnection(input: {
  agentId: string;
  endpoint: string;
  projectId: string;
  path: string;
  ref: string;
}): string | null {
  if (!input.agentId) return "Enter an agent name.";
  if (!input.projectId)
    return "Add a Project before connecting an external agent.";
  if (!input.path.trim() || !input.ref.trim())
    return "Choose a definition path and Git ref.";
  try {
    const url = new URL(input.endpoint);
    if (
      url.protocol !== "https:" ||
      url.port ||
      !(url.hostname === "vercel.app" || url.hostname.endsWith(".vercel.app"))
    )
      return "Enter an HTTPS vercel.app deployment URL.";
  } catch {
    return "Enter a valid Vercel deployment URL.";
  }
  return null;
}

export function chiefChannelConfiguration(input: {
  agentId: string;
  token: string;
  inboundUrl: string;
  deliverySigningKeyId: string;
  deliverySigningSecret: string;
}) {
  return Object.entries(chiefChannelEnvironment(input))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function chiefChannelEnvironment(input: {
  agentId: string;
  token: string;
  inboundUrl: string;
  deliverySigningKeyId: string;
  deliverySigningSecret: string;
}) {
  return {
    CHIEF_AGENT_ID: input.agentId,
    CHIEF_CHANNEL_TOKEN: input.token,
    CHIEF_DELIVERY_SIGNING_KEY_ID: input.deliverySigningKeyId,
    CHIEF_DELIVERY_SIGNING_SECRET: input.deliverySigningSecret,
    CHIEF_RELAY_URL: new URL(input.inboundUrl).origin,
    CHIEF_WORKSPACE_ID:
      input.inboundUrl.split("/workspaces/")[1]?.split("/")[0] ?? "",
  };
}

export async function verifyEveConnectionWithRetry(
  client: RelayClient["externalAgents"],
  agentId: string,
) {
  const retryDelays = [0, 1_000, 2_000, 4_000, 8_000] as const;
  let lastError: unknown;
  for (const delay of retryDelays) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    try {
      await client.verifyConnection(agentId);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Chief could not verify this Eve agent.");
}
