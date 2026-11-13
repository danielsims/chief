import type { ServerMessage } from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";

import type { hostedProviderModelsMessage } from "./hosted-provider-models";
import type { ProjectGitHubAccess } from "./relay-runtime-project-connect";

export type RelayRuntimeRelay = Pick<
  RelayClient,
  | "plugins"
  | "publishLocalProviderModels"
  | "schedules"
  | "channelSettings"
  | "activeWorkspace"
  | "appendMessage"
  | "uploadConversationAttachment"
  | "createChannel"
  | "createProject"
  | "deleteWorkspaceSecret"
  | "createNativeAgent"
  | "addChannelMembers"
  | "listChannelMembers"
  | "listChannelMemberships"
  | "listChannels"
  | "listCurrentChannelMemberships"
  | "listMessages"
  | "loadAgentConfig"
  | "loadAgentConfigs"
  | "listAgentJobs"
  | "listProjects"
  | "listWorkspaceFiles"
  | "listWorkspaceSecrets"
  | "reactToMessage"
  | "removeChannelMember"
  | "removeAgent"
  | "registerAgentKey"
  | "saveAgentConfig"
  | "setWorkspaceSecret"
  | "startDirectMessage"
  | "stopConversation"
  | "subscribeWorkspace"
  | "updateProjectIcon"
  | "updateWorkspaceFile"
> &
  ProjectGitHubAccess &
  Partial<Pick<RelayClient, "startWorkspaceWelcome">>;

/** Shares what this computer's local providers can run with the workspace. */
export function publishLocalModels(
  relay: RelayRuntimeRelay,
  listed: Awaited<ReturnType<typeof hostedProviderModelsMessage>>,
) {
  if (listed.driver !== "codex" && listed.driver !== "claude") return;
  const models = listed.models.filter((model) => model.value !== "");
  if (models.length === 0) return;
  void relay
    .publishLocalProviderModels(listed.driver, models)
    .catch(() => undefined);
}

/** Workspace secrets by name. Values never leave the relay. */
export async function environmentMessage(
  relay: RelayRuntimeRelay,
  workspaceId: string,
): Promise<Extract<ServerMessage, { type: "workspaceEnvironmentVariables" }>> {
  const secrets = await relay.listWorkspaceSecrets();
  return {
    type: "workspaceEnvironmentVariables",
    workspaceId,
    variables: secrets
      .filter(({ name }) => !isInternalSecret(name))
      .map(({ name }) => ({ key: name, sensitive: true })),
  };
}

/** Credentials Chief manages itself, never edited as environment. */
function isInternalSecret(name: string) {
  return (
    name === "vercel-deployment" ||
    name.startsWith("external-agent.") ||
    name.startsWith("github-")
  );
}
