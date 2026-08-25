import type { ClientMessage } from "@chief/agent-runtime/types";
import { appendMessageCommandSchema } from "@chief/relay-contracts";

import type { RelayRuntimeRelay } from "./relay-runtime-relay";

export async function appendRelayMessage(
  relay: RelayRuntimeRelay,
  conversationId: string,
  message: Extract<ClientMessage, { type: "sendMessage" }>,
) {
  return await relay.appendMessage(
    conversationId,
    appendMessageCommandSchema.parse({
      commandId: crypto.randomUUID(),
      protocolVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: {
        messageId: message.messageId,
        conversationId,
        ...(message.threadRootId
          ? { threadRootId: message.threadRootId }
          : undefined),
        body: message.text,
        mentions: message.mentions ?? [],
        components: message.components ?? [],
      },
    }),
  );
}
