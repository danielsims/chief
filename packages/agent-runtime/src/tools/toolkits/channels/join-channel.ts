import { defineLocalTool } from "../../tool.js";
import { executeChannelTool } from "./execute.js";
import { channelVersionInputSchema } from "./input.js";

export const joinChannelTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/channels/{channelId}/join",
  operation: {
    operationId: "channels.join",
    summary: "Join an active public channel",
  },
  inputSchema: channelVersionInputSchema,
  execute: (request) => executeChannelTool(request, request.input),
});
