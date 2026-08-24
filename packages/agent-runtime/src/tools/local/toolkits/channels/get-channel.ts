import { defineLocalTool } from "../../tool.js";
import { executeChannelTool } from "./execute.js";

export const getChannelTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/channels/{channelId}",
  operation: {
    operationId: "channels.get",
    summary: "Get channel details",
  },
  execute: executeChannelTool,
});
