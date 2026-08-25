import { defineLocalTool } from "../../tool.js";
import { executeChannelTool } from "./execute.js";

export const listChannelActivityTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/channels/{channelId}/activity",
  operation: {
    operationId: "channels.activity.list",
    summary: "Read the channel management audit trail",
  },
  execute: executeChannelTool,
});
