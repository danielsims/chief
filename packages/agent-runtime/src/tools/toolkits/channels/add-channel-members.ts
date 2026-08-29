import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { optionalBoundedText } from "../../input.js";
import { channelMemberReferenceSchema } from "./input.js";

export const addChannelMembersDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/channels/{channelId}/members",
  operation: {
    operationId: "channels.members.add",
    summary: "Add validated agents to a channel",
  },
  inputSchema: z.object({
    expectedVersion: z.number().int().min(1).optional(),
    idempotencyKey: optionalBoundedText(120),
    members: z.array(channelMemberReferenceSchema).min(1).max(20),
  }),
});
