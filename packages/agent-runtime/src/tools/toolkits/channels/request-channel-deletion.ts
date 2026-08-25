import { z } from "zod";

import { boundedText } from "../../input.js";
import { defineLocalTool } from "../../tool.js";
import { executeChannelTool } from "./execute.js";

const requestChannelDeletionInputSchema = z.object({
  reason: boundedText(1_000).pipe(z.string().min(20)),
});

export const requestChannelDeletionTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/channels/{channelId}/deletion-request",
  operation: {
    operationId: "channels.deletion.request",
    summary: "Ask the workspace owner to permanently delete a channel",
  },
  inputSchema: requestChannelDeletionInputSchema,
  execute: (request) => executeChannelTool(request, request.input),
});
