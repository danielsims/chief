import type { ChatExecutionSelection } from "@chief/agent-runtime/types";

import { useRuntimeChat } from "./runtime-chat";

export function useChiefChat(
  chatId: string | null,
  initialExecution?: ChatExecutionSelection,
  selectedExecution?: ChatExecutionSelection,
  access?: "full" | "guarded",
  destination?: {
    channelId?: string;
    agentId?: string;
    wakeOnMentionOnly?: boolean;
    integrationDomain?: string;
    conversationSurface?: "direct" | "channel";
  },
) {
  return useRuntimeChat(
    chatId,
    "open",
    initialExecution,
    selectedExecution,
    access,
    destination?.integrationDomain ? "integration-setup" : undefined,
    destination?.integrationDomain,
    destination?.channelId,
    destination?.agentId,
    destination?.wakeOnMentionOnly,
    destination?.conversationSurface,
  );
}

export function useAnalyticsReportChat(
  chatId: string | null,
  access: "full" | "guarded",
) {
  return useRuntimeChat(
    chatId,
    "open",
    undefined,
    undefined,
    access,
    "analytics-report",
  );
}

/** A hard read-only transcript API. It intentionally exposes no send method. */
export function useObservedChat(chatId: string | null) {
  const observed = useRuntimeChat(chatId, "observe");
  return {
    messages: observed.messages,
    controls: observed.controls,
    chatReady: observed.chatReady,
  };
}
