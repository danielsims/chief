import type { RelayClient } from "@chief/relay-client";

export type RelayRuntimeRelay = Pick<
  RelayClient,
  | "schedules"
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
>;
