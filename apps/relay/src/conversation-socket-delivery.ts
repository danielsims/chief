import { z } from "zod";

import type { JsonObject } from "@chief/relay-contracts";
import {
  conversationEventSchema,
  conversationIdSchema,
  principalSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { fenceGuestEvent } from "./channel-guest-fence";
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
  const parsed = conversationEventSchema.safeParse(event);
  const guestAuthored = /"kind":"guest"/u.test(serialized);
  await Promise.all(
    sockets.map(async (socket) => {
      try {
        const context = attachmentSchema.parse(socket.deserializeAttachment());
        await authorizeConversation(env, {
          ...context,
          requestId: crypto.randomUUID(),
          permission: "messages.read",
        });
        // People read guest text as written. Other readers get it fenced, and
        // never receive guest-authored text that could not be fenced.
        if (context.principal.kind === "user") socket.send(serialized);
        else if (parsed.success)
          socket.send(
            JSON.stringify(fenceGuestEvent(context.principal, parsed.data)),
          );
        else if (!guestAuthored) socket.send(serialized);
      } catch {
        // Old sockets without identity attachments must reconnect and authenticate.
        socket.close(1008, "Conversation access must be renewed");
      }
    }),
  );
}
