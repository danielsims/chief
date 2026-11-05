import type { ConversationMessage } from "@chief/relay-contracts";

import {
  agentRunEvent,
  agentWorkingChange,
  isAgentActivityProjection,
} from "../lib/relay-runtime-mappers";

/** A run remains active through intermediate replies; failures are never hidden. */
export function automationChatState(messages: readonly ConversationMessage[]) {
  const lastUser = messages
    .map((message) => message.author.kind)
    .lastIndexOf("user");
  if (lastUser < 0) return { working: false, error: undefined };
  const latest = messages.slice(lastUser + 1).reverse();
  for (const message of latest) {
    const event = agentRunEvent(message);
    if (event?.type === "error") return { working: false, error: event };
    const change = agentWorkingChange(message);
    if (change) return { working: change.working, error: undefined };
  }
  return {
    working: !latest.some(
      (message) =>
        !isAgentActivityProjection(message) && message.author.kind === "agent",
    ),
    error: undefined,
  };
}
