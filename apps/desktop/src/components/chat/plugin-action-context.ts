import type { ChiefUIMessage } from "@chief/agent-runtime/types";

import type { RelayPluginActionContext } from "../../lib/runtime-plugins";

export function pluginActionContextForMessage({
  message,
  workspaceId,
  conversationId,
  fallbackAgentId,
}: {
  message: ChiefUIMessage;
  workspaceId?: string | null;
  conversationId: string;
  fallbackAgentId: string;
}): RelayPluginActionContext | undefined {
  if (!workspaceId) return undefined;
  return {
    workspaceId,
    conversationId,
    ...(message.metadata?.threadRootId
      ? { threadRootId: message.metadata.threadRootId }
      : {}),
    agentId: message.metadata?.agentId ?? fallbackAgentId,
    recommendationId: message.id,
  };
}
