import { z } from "zod";

import { boundedText, optionalBoundedText } from "../../../input.js";
import { defineLocalTool } from "../../../tool.js";
import { executeChannelTool } from "../execute.js";

const searchMessagesQuerySchema = z.object({
  query: boundedText(500).pipe(z.string().min(2)),
  channelId: optionalBoundedText(160),
  authorId: optionalBoundedText(160),
  after: z.coerce.number().int().optional(),
  before: z.coerce.number().int().optional(),
  cursor: optionalBoundedText(240),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const searchMessagesTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/messages/search",
  operation: {
    operationId: "channels.messages.search",
    summary: "Search visible roots and thread replies",
  },
  querySchema: searchMessagesQuerySchema,
  execute: executeChannelTool,
});
