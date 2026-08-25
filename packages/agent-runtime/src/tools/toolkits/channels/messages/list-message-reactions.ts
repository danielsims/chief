import { defineLocalTool } from "../../../tool.js";
import { executeChannelTool } from "../execute.js";

export const listMessageReactionsTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/channels/{channelId}/messages/{messageId}/reactions",
  operation: {
    operationId: "channels.reactions.list",
    summary: "List reactions",
  },
  execute: executeChannelTool,
});
