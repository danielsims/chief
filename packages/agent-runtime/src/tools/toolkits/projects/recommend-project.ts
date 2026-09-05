import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText, optionalBoundedText } from "../../input.js";

export const recommendProjectDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/channels/{channelId}/projects/recommend",
  operation: {
    operationId: "projects.recommend",
    summary: "Ask the user to connect a Git repository",
    description:
      "Publishes a durable connect-repository card in the current channel, thread, or direct message. Use this when the workspace has no Git project yet instead of asking the user to paste a URL in chat. This does not clone or attach a repository.",
  },
  inputSchema: z.object({
    content: boundedText(1_000),
    remoteUrl: optionalBoundedText(2_048),
    threadRootId: optionalBoundedText(160),
    idempotencyKey: boundedText(120),
  }),
});
