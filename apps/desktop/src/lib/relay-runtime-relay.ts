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
  | "listProjects"
  | "listProspects"
  | "listWorkspaceFiles"
  | "reactToMessage"
  | "startDirectMessage"
  | "subscribeWorkspace"
  | "updateWorkspaceFile"
>;
