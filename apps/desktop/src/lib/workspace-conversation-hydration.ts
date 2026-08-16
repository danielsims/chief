import { useEffect } from "react";

import {
  isConversationHydrated,
  markConversationHydrated,
} from "./workspace-conversation-cache";

export function useConversationHydration({
  channelId,
  chatId,
  currentlyResolved,
  surface,
  workspaceId,
}: {
  channelId?: string;
  chatId: string | null;
  currentlyResolved: boolean;
  surface: "direct" | "channel";
  workspaceId: string | null;
}) {
  const previouslyHydrated = Boolean(
    workspaceId &&
    chatId &&
    isConversationHydrated(workspaceId, chatId, surface, channelId),
  );

  useEffect(() => {
    if (!currentlyResolved || !workspaceId || !chatId) return;
    markConversationHydrated(workspaceId, chatId, surface, channelId);
  }, [channelId, chatId, currentlyResolved, surface, workspaceId]);

  return currentlyResolved || previouslyHydrated;
}
