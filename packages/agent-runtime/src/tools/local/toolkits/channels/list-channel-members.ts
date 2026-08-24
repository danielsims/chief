import { defineLocalTool } from "../../tool.js";
import { executeChannelTool } from "./execute.js";

export const listChannelMembersTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/channels/{channelId}/members",
  operation: {
    operationId: "channels.members.list",
    summary: "List channel members",
  },
  execute: executeChannelTool,
});
