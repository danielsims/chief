import { defineLocalTool } from "../../../tool.js";
import { executeChannelTool } from "../execute.js";

export const removeMessageReactionTool = defineLocalTool({
  method: "DELETE",
  path: "/local-tools/channels/{channelId}/messages/{messageId}/reactions/{emoji}",
  operation: {
    operationId: "channels.reactions.remove",
    summary: "Remove the caller's reaction",
  },
  execute: executeChannelTool,
});
