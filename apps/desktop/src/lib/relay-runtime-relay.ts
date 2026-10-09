import type { RelayClient } from "@chief/relay-client";

import type { ProjectGitHubAccess } from "./relay-runtime-project-connect";

export type RelayRuntimeRelay = Pick<
  RelayClient,
  | "schedules"
  | "channelSettings"
  | "activeWorkspace"
  | "appendMessage"
  | "createChannel"
  | "createProject"
  | "deleteWorkspaceSecret"
  | "createNativeAgent"
  | "listChannelMembers"
  | "listChannelMemberships"
  | "listChannels"
  | "listCurrentChannelMemberships"
  | "listMessages"
  | "loadAgentConfig"
  | "listAgentJobs"
  | "listProjects"
  | "listProspects"
  | "listWorkspaceFiles"
  | "listWorkspaceSecrets"
  | "reactToMessage"
  | "removeAgent"
  | "registerAgentKey"
  | "saveAgentConfig"
  | "setWorkspaceSecret"
  | "startDirectMessage"
  | "stopConversation"
  | "subscribeWorkspace"
  | "updateWorkspaceFile"
> &
  ProjectGitHubAccess;
