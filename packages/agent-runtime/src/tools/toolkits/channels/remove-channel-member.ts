import { defineLocalTool } from "../../tool.js";
import { executeChannelTool } from "./execute.js";
import { channelVersionInputSchema } from "./input.js";

export const removeChannelMemberTool = defineLocalTool({
  method: "DELETE",
  path: "/local-tools/channels/{channelId}/members/{memberId}",
  operation: {
    operationId: "channels.members.remove",
    summary: "Remove a member from a channel",
  },
  inputSchema: channelVersionInputSchema,
  execute: (request) => executeChannelTool(request, request.input),
});
