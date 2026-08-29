import { defineLocalTool } from "../../../tool.js";
import { executeChannelTool } from "../execute.js";
import { messagePagingQuerySchema } from "./input.js";

export const listThreadRepliesTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/channels/{channelId}/messages/{messageId}/replies",
  operation: {
    operationId: "channels.messages.replies",
    summary: "Read a complete thread before acting on its root",
  },
  querySchema: messagePagingQuerySchema,
  execute: executeChannelTool,
});
