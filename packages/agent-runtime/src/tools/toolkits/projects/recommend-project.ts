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
      "Publishes a durable connect-repository card in the current conversation so the user can attach a repository that already exists on GitHub or another Git provider. Use it only when the user wants to attach such a repository; it does not create, clone or attach anything itself. To make a new repository, create it directly instead.",
  },
  inputSchema: z.object({
    content: boundedText(1_000),
    remoteUrl: optionalBoundedText(2_048),
    threadRootId: optionalBoundedText(160),
    idempotencyKey: boundedText(120),
  }),
});
