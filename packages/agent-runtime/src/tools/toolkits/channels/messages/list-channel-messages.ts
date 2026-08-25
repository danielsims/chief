import { defineAgentTool } from "../../../definition.js";
import { messagePagingQuerySchema } from "./input.js";

export const listChannelMessagesDefinition = defineAgentTool({
  method: "GET",
  path: "/local-tools/channels/{channelId}/messages",
  operation: {
    operationId: "channels.messages.list",
    summary: "List channel roots with recent thread replies",
  },
  querySchema: messagePagingQuerySchema,
});
