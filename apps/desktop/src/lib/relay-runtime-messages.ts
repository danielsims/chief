import type {
  ClientMessage,
  MessageAttachment,
} from "@chief/agent-runtime/types";
import type { MessageComponent } from "@chief/relay-contracts";
import { appendMessageCommandSchema } from "@chief/relay-contracts";

import type { RelayRuntimeRelay } from "./relay-runtime-relay";

export async function appendRelayMessage(
  relay: RelayRuntimeRelay,
  conversationId: string,
  message: Extract<ClientMessage, { type: "sendMessage" }>,
) {
  // Images go up first, to the conversation's own storage. The message then
  // references them, so everyone who can read the channel can see them and
  // nobody else can.
  const attachments = await Promise.all(
    (message.attachments ?? []).map((attachment) =>
      uploadedAttachment(relay, conversationId, attachment),
    ),
  );
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
        components: [...(message.components ?? []), ...attachments],
      },
    }),
  );
}

async function uploadedAttachment(
  relay: RelayRuntimeRelay,
  conversationId: string,
  attachment: MessageAttachment,
): Promise<MessageComponent> {
  const marker = ";base64,";
  const start = attachment.url.indexOf(marker);
  if (!attachment.url.startsWith("data:") || start < 0)
    throw new Error("Chief couldn't read that image.");
  const uploaded = await relay.uploadConversationAttachment(conversationId, {
    fileName: attachment.name,
    contentType: attachment.mediaType,
    base64: attachment.url.slice(start + marker.length),
  });
  return {
    id: crypto.randomUUID(),
    kind: "attachment",
    version: 1,
    payload: {
      name: attachment.name,
      mediaType: attachment.mediaType,
      url: uploaded.url,
    },
  };
}
