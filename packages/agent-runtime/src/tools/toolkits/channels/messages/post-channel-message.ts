import { z } from "zod";

import { defineAgentTool } from "../../../definition.js";
import { boundedText, optionalBoundedText } from "../../../input.js";

export const postChannelMessageDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/channels/{channelId}/messages",
  operation: {
    operationId: "channels.messages.post",
    summary: "Publish a message or thread reply",
    description:
      "Publishes deliberate user-facing content into a shared channel. Address people and agents with @Name and include their principal IDs in mentions. Channel members.list returns each person's name, role, and id. Never invent a @chief (user) tag. To present work, first create or revise it with files.write (or publish binary media), then pass its file ID in artifactIds. This inserts clickable cards opening those artifacts in this channel’s Canvas. Only artifacts belonging to this channel can be attached. Ordinary agent working output is private and does not appear in the channel.",
  },
  inputSchema: z.object({
    artifactIds: z.array(boundedText(160)).max(12).optional(),
    content: boundedText(8_000),
    threadRootId: optionalBoundedText(160),
    mentions: z.array(boundedText(120)).max(20).optional(),
    idempotencyKey: optionalBoundedText(120),
  }),
});
