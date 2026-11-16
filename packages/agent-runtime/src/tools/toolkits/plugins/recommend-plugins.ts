import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText, optionalBoundedText } from "../../input.js";

const recommendationValuesSchema = z.array(boundedText(120)).min(1);

export const recommendPluginsDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/channels/{channelId}/plugins/recommend",
  operation: {
    operationId: "plugins.recommend",
    summary: "Show plugins as cards in a conversation",
    description:
      'Shows plugins to the person as cards they can click to connect or manage. This is the only way people see plugins: use it whenever you mention specific plugins, connected or not, instead of listing them in text. Pass pluginIds from plugins_list, or services by name. Use scope: "connected" to show all connected plugins in one call. This does not install or authorize a plugin.',
  },
  inputSchema: z
    .object({
      content: boundedText(1_000),
      pluginIds: recommendationValuesSchema.optional(),
      services: recommendationValuesSchema.optional(),
      scope: z.literal("connected").optional(),
      threadRootId: optionalBoundedText(160),
      idempotencyKey: boundedText(120),
    })
    .refine(
      (input) =>
        Boolean(input.pluginIds?.length) ||
        Boolean(input.services?.length) ||
        input.scope === "connected",
      { message: "pluginIds, services or scope are required." },
    ),
});
