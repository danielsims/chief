import type { WorkspaceAgentId } from "../../lib/workspace-channels";

export type ConversationProfileSelection =
  { kind: "user" } | { kind: "agent"; agentId: WorkspaceAgentId };
