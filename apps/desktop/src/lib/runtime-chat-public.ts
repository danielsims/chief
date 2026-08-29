import type {
  ChatExecutionSelection,
  InputRequest,
} from "@chief/agent-runtime/types";

import { useRuntimeChat } from "./runtime-chat";
/** Durable NIP-29 events for channel timelines and message search. */
import { useRuntime } from "./runtime-provider";
import { useWorkspaceCapability } from "./workspace-capability";

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
export function useObservedChat(
  chatId: string | null,
  recurringWorkId?: string,
) {
  const observed = useRuntimeChat(chatId, "observe");
  const { client } = useRuntime();
  const { cloudOrganizationId, capability } = useWorkspaceCapability();
  const provideInput = (
    request: InputRequest,
    values: Record<string, string>,
  ) => {
    if (!chatId || !cloudOrganizationId || !capability) return;
    client.send({
      type: "provideInput",
      workspaceId: cloudOrganizationId,
      chatId,
      request,
      values,
      executorCapability: capability,
      recurringWorkId,
    });
  };
  return {
    messages: observed.messages,
    controls: observed.controls,
    chatReady: observed.chatReady,
    provideInput,
  };
}
