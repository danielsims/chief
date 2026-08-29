import { z } from "zod";

import { optionalBoundedText } from "../../input.js";
import { defineLocalTool } from "../../tool.js";
import { executeChannelTool } from "./execute.js";
import { channelWorkstreamInputSchema } from "./input.js";

const channelUpdateInputSchema = z.object({
  expectedVersion: z.number().int().min(1).optional(),
  name: optionalBoundedText(60),
  description: optionalBoundedText(160),
  topic: optionalBoundedText(250),
  workstream: channelWorkstreamInputSchema.optional(),
});

export const updateChannelTool = defineLocalTool({
  method: "PATCH",
  path: "/local-tools/channels/{channelId}",
  operation: {
    operationId: "channels.update",
    summary: "Update metadata or feature-work state",
  },
  inputSchema: channelUpdateInputSchema,
  execute: (request) => executeChannelTool(request, request.input),
});
