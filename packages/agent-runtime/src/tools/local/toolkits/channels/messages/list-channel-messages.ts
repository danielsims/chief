import { defineLocalTool } from "../../../tool.js";
import { executeChannelTool } from "../execute.js";
import { messagePagingQuerySchema } from "./input.js";

export const listChannelMessagesTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/channels/{channelId}/messages",
  operation: {
    operationId: "channels.messages.list",
    summary: "List channel roots with recent thread replies",
  },
  querySchema: messagePagingQuerySchema,
  execute: executeChannelTool,
});
