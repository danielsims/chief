import type { RelayClient } from "@chief/relay-client";

export type RelayRuntimeRelay = Pick<
  RelayClient,
  | "activeWorkspace"
  | "appendMessage"
  | "createChannel"
  | "createProject"
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
  | "registerAgentKey"
  | "saveAgentConfig"
  | "startDirectMessage"
  | "subscribeWorkspace"
  | "updateWorkspaceFile"
>;
