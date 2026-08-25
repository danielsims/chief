import { defineLocalTool } from "../../tool.js";
import { executeChannelTool } from "./execute.js";
import { channelVersionInputSchema } from "./input.js";

export const leaveChannelTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/channels/{channelId}/leave",
  operation: {
    operationId: "channels.leave",
    summary: "Leave a channel",
  },
  inputSchema: channelVersionInputSchema,
  execute: (request) => executeChannelTool(request, request.input),
});
