import { z } from "zod";

import { channelKinds, channelVisibilities } from "@chief/channel-api";

import { boundedText, optionalBoundedText } from "../../input.js";
import { defineLocalTool } from "../../tool.js";
import { executeChannelTool } from "./execute.js";
import {
  channelMemberReferenceSchema,
  channelWorkstreamInputSchema,
} from "./input.js";

const channelCreateInputSchema = z.object({
  name: boundedText(60),
  description: optionalBoundedText(160),
  topic: optionalBoundedText(250),
  visibility: z.enum(channelVisibilities).optional(),
  kind: z.enum(channelKinds).optional(),
  operationKey: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{5,79}$/u)
    .max(80),
  agentIds: z.array(boundedText(80)).max(20).optional(),
  members: z.array(channelMemberReferenceSchema).max(20).optional(),
  workstream: channelWorkstreamInputSchema.optional(),
});

export const createChannelTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/channels",
  operation: {
    operationId: "channels.create",
    summary: "Create a standard or feature channel",
    description:
      "Use a stable operationKey for retries. The calling agent is added automatically; additional agents are validated before the channel is written.",
  },
  inputSchema: channelCreateInputSchema,
  execute: (request) => executeChannelTool(request, request.input),
});
