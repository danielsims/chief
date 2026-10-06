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
  | "reactToMessage"
  | "removeAgent"
  | "registerAgentKey"
  | "saveAgentConfig"
  | "startDirectMessage"
  | "subscribeWorkspace"
  | "updateWorkspaceFile"
> &
  ProjectGitHubAccess;
