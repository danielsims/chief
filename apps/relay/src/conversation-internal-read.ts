import { messageIdSchema } from "@chief/relay-contracts";

import type { SqlConversationStore } from "./conversation-store";
import { parseConversationPageInteger } from "./conversation-request";
import { json, relayError } from "./http";

export function conversationInternalRead(
  request: Request,
  store: SqlConversationStore,
) {
  const operation = request.headers.get("x-chief-internal-operation");
  if (operation === "message-exists") {
    return {
      telemetry: "conversation.message.exists",
      read() {
        const segment = new URL(request.url).pathname.split("/").pop() ?? "";
        const message = store.getMessage(
          messageIdSchema.parse(decodeURIComponent(segment)),
        );
        return message
          ? json({ exists: true })
          : relayError(404, "message_not_found", "Message not found.");
      },
    };
  }
  if (operation === "agent-history")
    return {
      telemetry: "conversation.agent_history",
      read() {
        const url = new URL(request.url);
        const limit = parseConversationPageInteger(
          url.searchParams.get("limit"),
          30,
          1,
          100,
        );
        const rawThreadRootId = url.searchParams.get("threadRootId");
        const threadRootId = rawThreadRootId
          ? messageIdSchema.parse(rawThreadRootId)
          : undefined;
        return json({
          messages: store.history(threadRootId, limit),
          nextSequence: null,
        });
      },
    };
  return undefined;
}
