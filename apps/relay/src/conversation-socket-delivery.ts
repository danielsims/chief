import { z } from "zod";

import type { JsonObject } from "@chief/relay-contracts";
import {
  conversationIdSchema,
  principalSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { authorizeConversation } from "./workspace-authorization";

const attachmentSchema = z.object({
  principal: principalSchema,
  workspaceId: workspaceIdSchema,
  conversationId: conversationIdSchema,
});

/** Recheck current membership before every delivery, including after hibernation. */
export async function deliverConversationSocketEvent(
  env: Env,
  sockets: readonly Pick<
    WebSocket,
    "send" | "close" | "deserializeAttachment"
  >[],
  event: JsonObject,
) {
  const serialized = JSON.stringify(event);
  await Promise.all(
    sockets.map(async (socket) => {
      try {
        const context = attachmentSchema.parse(socket.deserializeAttachment());
        await authorizeConversation(env, {
          ...context,
          requestId: crypto.randomUUID(),
          permission: "messages.read",
        });
        socket.send(serialized);
      } catch {
        // Old sockets without identity attachments must reconnect and authenticate.
        socket.close(1008, "Conversation access must be renewed");
      }
    }),
  );
}
