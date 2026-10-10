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
  | "listProspects"
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
  | "updateWorkspaceFile"
> &
  ProjectGitHubAccess;
