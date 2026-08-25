import { defineLocalTool } from "../../tool.js";
import { executeChannelTool } from "./execute.js";
import { channelVersionInputSchema } from "./input.js";

export const unarchiveChannelTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/channels/{channelId}/unarchive",
  operation: {
    operationId: "channels.unarchive",
    summary: "Restore an archived channel",
  },
  inputSchema: channelVersionInputSchema,
  execute: (request) => executeChannelTool(request, request.input),
});
