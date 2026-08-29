import { defineLocalTool } from "../../tool.js";
import { executeChannelTool } from "./execute.js";
import { channelVersionInputSchema } from "./input.js";

export const archiveChannelTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/channels/{channelId}/archive",
  operation: {
    operationId: "channels.archive",
    summary: "Archive a channel without losing history",
  },
  inputSchema: channelVersionInputSchema,
  execute: (request) => executeChannelTool(request, request.input),
});
