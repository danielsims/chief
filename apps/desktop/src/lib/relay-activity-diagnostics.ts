import type { ConversationEvent } from "@chief/relay-contracts";

export function recordDesktopActivityReceipt(
  workspaceId: string,
  event: ConversationEvent,
) {
  const message = event.payload.message;
  console.info(
    "[client-activity]",
    JSON.stringify({
      scope: "desktop.activity",
      phase: "received",
      workspaceId,
      conversationId: message.conversationId,
      threadRootId: message.threadRootId,
      agentId: message.author.kind === "agent" ? message.author.id : undefined,
      messageId: message.id,
      componentIds: message.components.map((component) => component.id),
      sequence: event.sequence,
      eventType: event.type,
    }),
  );
}
