import type { WorkspaceAgentId } from "../../lib/workspace-channels";

export type ConversationProfileSelection =
  /** `userId` names another workspace member; omitted means the signed-in user. */
  | { kind: "user"; userId?: string }
  | { kind: "agent"; agentId: WorkspaceAgentId };
