import { z } from "zod";

import { boundedText, optionalBoundedText } from "../../../input.js";
import { defineLocalTool } from "../../../tool.js";
import { executeChannelTool } from "../execute.js";

const channelMessageInputSchema = z.object({
  content: boundedText(8_000),
  threadRootId: optionalBoundedText(160),
  mentions: z.array(boundedText(120)).max(20).optional(),
  idempotencyKey: optionalBoundedText(120),
});

export const postChannelMessageTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/channels/{channelId}/messages",
  operation: {
    operationId: "channels.messages.post",
    summary: "Publish a message or thread reply",
    description:
      "Publishes deliberate user-facing content into a shared channel. Ordinary agent working output is private and does not appear in the channel.",
  },
  inputSchema: channelMessageInputSchema,
  execute: (request) => executeChannelTool(request, request.input),
});
