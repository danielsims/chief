import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText, optionalBoundedText } from "../../input.js";

const recommendationValuesSchema = z.array(boundedText(120)).min(1).max(8);

export const recommendPluginsDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/channels/{channelId}/plugins/recommend",
  operation: {
    operationId: "plugins.recommend",
    summary: "Recommend plugins in a conversation",
    description:
      "Resolves real catalog plugins and publishes durable, actionable plugin cards in the specified channel, thread, or direct message. This does not install or authorize a plugin.",
  },
  inputSchema: z
    .object({
      content: boundedText(1_000),
      pluginIds: recommendationValuesSchema.optional(),
      services: recommendationValuesSchema.optional(),
      threadRootId: optionalBoundedText(160),
      idempotencyKey: boundedText(120),
    })
    .refine(
      (input) =>
        Boolean(input.pluginIds?.length) || Boolean(input.services?.length),
      { message: "pluginIds or services are required." },
    ),
});
