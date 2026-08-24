import { z } from "zod";

import { optionalBoundedText } from "../../input.js";
import { defineLocalTool } from "../../tool.js";
import { executeChannelTool } from "./execute.js";
import { channelMemberReferenceSchema } from "./input.js";

const channelMembersAddInputSchema = z.object({
  expectedVersion: z.number().int().min(1).optional(),
  idempotencyKey: optionalBoundedText(120),
  members: z.array(channelMemberReferenceSchema).min(1).max(20),
});

export const addChannelMembersTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/channels/{channelId}/members",
  operation: {
    operationId: "channels.members.add",
    summary: "Add validated agents to a channel",
  },
  inputSchema: channelMembersAddInputSchema,
  execute: (request) => executeChannelTool(request, request.input),
});
