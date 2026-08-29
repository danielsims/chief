import { z } from "zod";

import { boundedText, optionalBoundedText } from "../../../input.js";
import { defineLocalTool } from "../../../tool.js";
import { executeChannelTool } from "../execute.js";

const editChannelMessageInputSchema = z.object({
  content: boundedText(8_000),
  expectedVersion: z.number().int().min(1).optional(),
  idempotencyKey: optionalBoundedText(120),
});

export const editChannelMessageTool = defineLocalTool({
  method: "PATCH",
  path: "/local-tools/channels/{channelId}/messages/{messageId}",
  operation: {
    operationId: "channels.messages.update",
    summary: "Edit the caller's message",
  },
  inputSchema: editChannelMessageInputSchema,
  execute: (request) => executeChannelTool(request, request.input),
});
