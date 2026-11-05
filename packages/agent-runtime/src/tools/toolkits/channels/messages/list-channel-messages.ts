import { z } from "zod";

import { defineAgentTool } from "../../../definition.js";
import { messagePagingQuerySchema } from "./input.js";

export const listChannelMessagesDefinition = defineAgentTool({
  method: "GET",
  path: "/local-tools/channels/{channelId}/messages",
  operation: {
    operationId: "channels.messages.list",
    summary: "Read channel messages",
    description:
      "Read the latest five meaningful channel messages, newest first. Pass nextSequence as cursor for the next five older messages; null means no older messages. Set limit (1–100) explicitly for a larger page. Pages are bounded to 16000 serialized characters and omit run-log/thinking/tool payloads. Bodies default to 2000-character previews: bodyTruncated means the full message was not read. To expand one truncated message, set cursor to that message's sequence plus 1, limit to 1, and bodyChars to 8000. A recent page does not cover the entire channel history.",
  },
  querySchema: messagePagingQuerySchema.extend({
    limit: z.coerce.number().int().min(1).max(100).default(5),
    bodyChars: z.coerce.number().int().min(1).max(8000).optional(),
  }),
});
