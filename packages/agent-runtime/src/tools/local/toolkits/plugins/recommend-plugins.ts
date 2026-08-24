import { z } from "zod";

import { toJsonObject } from "@chief/relay-contracts";

import { handleChannelLocalTool } from "../../../../channel-local-tools.js";
import { boundedText, optionalBoundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const recommendationValuesSchema = z.array(boundedText(120)).min(1).max(8);

export const recommendPluginsInputSchema = z
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
  );

export const recommendPluginsTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/channels/{channelId}/plugins/recommend",
  operation: {
    operationId: "plugins.recommend",
    summary: "Recommend plugins in a conversation",
    description:
      "Resolves real catalog plugins and publishes durable, actionable plugin cards in the specified channel, thread, or direct message. This does not install or authorize a plugin.",
  },
  inputSchema: recommendPluginsInputSchema,
  async execute({ request, workspaceId, context, input }) {
    const channelContext = context.channels;
    if (!channelContext) {
      return jsonResponse(
        {
          error: "Channel management is unavailable.",
          code: "channel_api_unavailable",
        },
        503,
      );
    }
    const result = await handleChannelLocalTool(
      request,
      workspaceId,
      toJsonObject(input),
      { ...channelContext, plugins: context.plugins },
    );
    return jsonResponse(result.value, result.status);
  },
});
