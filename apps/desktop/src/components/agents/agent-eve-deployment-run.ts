import type {
  AgentDefinition,
  EveAgentProvisioningProgress,
  EveAgentProvisioningResult,
} from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import { agentIdSchema } from "@chief/relay-contracts";

import { provisionEveAgent } from "../../lib/vercel-eve-runtime";
import {
  chiefChannelEnvironment,
  isReservedVercelProjectName,
  preferredVercelProjectName,
} from "./agent-connection-model";
import { projectSlug } from "./agent-eve-deployment-draft";

export type DestinationCatalog = Awaited<
  ReturnType<RelayClient["listVercelDestinations"]>
>;

export const destinationCatalogCache = new Map<string, DestinationCatalog>();

export async function runEveAgentDeployment({
  agent,
  client,
  deploymentInstructions,
  effectiveModel,
  projectId,
  projectMode,
  projectName,
  resolvedWorkspaceName,
  teamId,
  onCatalog,
  onProgress,
  onProjectName,
}: {
  agent: AgentDefinition;
  client: RelayClient;
  deploymentInstructions: string;
  effectiveModel: string;
  projectId: string;
  projectMode: "new" | "existing";
  projectName: string;
  resolvedWorkspaceName: string;
  teamId: string;
  onCatalog: (catalog: DestinationCatalog) => void;
  onProgress: (progress: EveAgentProvisioningProgress) => void;
  onProjectName: (name: string) => void;
}): Promise<EveAgentProvisioningResult> {
  const live = await client.listVercelDestinations(teamId);
  if (client.workspaceId) {
    destinationCatalogCache.set(client.workspaceId, live);
  }
  onCatalog(live);
  const selectedProject = live.projects.find(
    (project) => project.id === projectId,
  );
  const destinationName =
    projectMode === "existing"
      ? selectedProject?.name
      : preferredVercelProjectName(
          resolvedWorkspaceName,
          projectSlug(projectName),
        );
  if (!destinationName)
    throw new Error(
      projectMode === "existing"
        ? "Choose the Vercel project to deploy to."
        : "Enter the name of the Vercel project to create.",
    );
  if (isReservedVercelProjectName(destinationName)) {
    throw new Error(
      `"${destinationName}" is reserved for Chief's own Vercel project. Deploy this Eve agent under a different name.`,
    );
  }
  if (projectMode === "new") onProjectName(destinationName);
  const provisionalEndpoint = `https://${destinationName}.vercel.app/channels/chief/messages`;
  const registration = await client.externalAgents.register({
    agentId: agentIdSchema.parse(agent.id),
    name: agent.name,
    role: agent.role,
    description: agent.description,
    instructions: deploymentInstructions,
    endpoint: provisionalEndpoint,
    replaceNative: true,
  });
  const channel = { agentId: agent.id, ...registration.channel };
  const result = await provisionEveAgent({
    client,
    input: {
      teamId,
      project:
        projectMode === "existing" && selectedProject
          ? {
              kind: "existing",
              projectId: selectedProject.id,
              projectName: selectedProject.name,
            }
          : { kind: "new", projectName: destinationName },
      agent: {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        description: agent.description,
        instructions: deploymentInstructions,
        capabilities: agent.capabilities,
        subagents: agent.subagents,
        model: effectiveModel,
      },
      environment: chiefChannelEnvironment(channel),
    },
    onProgress,
  });
  const deployedEndpoint = new URL(
    "/channels/chief/messages",
    result.deploymentUrl,
  );
  await client.externalAgents.updateEndpoint(
    agent.id,
    deployedEndpoint.toString(),
  );
  return result;
}
