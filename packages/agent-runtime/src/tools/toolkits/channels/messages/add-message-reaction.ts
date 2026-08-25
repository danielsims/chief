import { z } from "zod";

import { boundedText } from "../../../input.js";
import { defineLocalTool } from "../../../tool.js";
import { executeChannelTool } from "../execute.js";

const channelReactionInputSchema = z.object({
  emoji: boundedText(80),
});

export const addMessageReactionTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/channels/{channelId}/messages/{messageId}/reactions",
  operation: {
    operationId: "channels.reactions.add",
    summary: "Add an idempotent reaction",
  },
  inputSchema: channelReactionInputSchema,
  execute: (request) => executeChannelTool(request, request.input),
});
