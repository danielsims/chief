import { defineLocalTool } from "../../../tool.js";
import { executeChannelTool } from "../execute.js";

export const getChannelMessageTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/channels/{channelId}/messages/{messageId}",
  operation: {
    operationId: "channels.messages.get",
    summary: "Get a message with its immediate thread context",
  },
  execute: executeChannelTool,
});
