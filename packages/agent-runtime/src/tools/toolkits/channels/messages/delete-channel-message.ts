import { z } from "zod";

import { optionalBoundedText } from "../../../input.js";
import { defineLocalTool } from "../../../tool.js";
import { executeChannelTool } from "../execute.js";

const deleteChannelMessageInputSchema = z.object({
  reason: optionalBoundedText(240),
});

export const deleteChannelMessageTool = defineLocalTool({
  method: "DELETE",
  path: "/local-tools/channels/{channelId}/messages/{messageId}",
  operation: {
    operationId: "channels.messages.delete",
    summary: "Tombstone the caller's message",
  },
  inputSchema: deleteChannelMessageInputSchema,
  execute: (request) => executeChannelTool(request, request.input),
});
