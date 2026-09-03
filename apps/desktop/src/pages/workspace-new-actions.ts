import type { RelayClient } from "@chief/relay-client";
import type {
  CreateWorkspaceCommand,
  WorkspaceSnapshot,
} from "@chief/relay-contracts";
import { listVercelEveDestinations } from "@chief/agent-runtime/vercel-eve-provisioning";
import { createWorkspaceCommandSchema } from "@chief/relay-contracts";

type CreateWorkspace = (
  command: CreateWorkspaceCommand,
  apiKey: string,
) => Promise<WorkspaceSnapshot>;

export function createRelayWorkspace({
  apiKey,
  commandId,
  createWorkspace,
  inferenceProvider,
  name,
  selectedApps,
  website,
}: {
  apiKey: string;
  commandId: string;
  createWorkspace: CreateWorkspace;
  inferenceProvider: "opencode" | "vercelAiGateway";
  name: string;
  selectedApps: readonly string[];
  website: string;
}) {
  return createWorkspace(
    createWorkspaceCommandSchema.parse({
      commandId,
      name,
      website,
      runtime: "cloud",
      agentRuntime: "relay-cell",
      inferenceProvider,
      inferenceModel: "auto",
      selectedApps,
    }),
    apiKey,
  );
}

export function createEveWorkspace({
  commandId,
  createWorkspace,
  name,
  selectedApps,
  website,
}: {
  commandId: string;
  createWorkspace: CreateWorkspace;
  name: string;
  selectedApps: readonly string[];
  website: string;
}) {
  return createWorkspace(
    createWorkspaceCommandSchema.parse({
      commandId,
      name,
      website,
      runtime: "cloud",
      agentRuntime: "vercel-eve",
      inferenceProvider: "vercelAiGateway",
      inferenceModel: "auto",
      selectedApps,
    }),
    "",
  );
}

export function previewVercelDestinations({
  fetcher,
  teamId,
  token,
}: {
  fetcher?: typeof fetch;
  teamId?: string;
  token: string;
}) {
  const options: {
    token: string;
    teamId?: string;
    fetcher?: typeof fetch;
  } = { token };
  if (teamId) options.teamId = teamId;
  if (fetcher) options.fetcher = fetcher;
  return listVercelEveDestinations(options);
}

export async function connectEveWorkspace({
  client,
  token,
}: {
  client: RelayClient;
  token: string;
}) {
  return await client.connectVercel(token);
}
