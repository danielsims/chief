import { toJsonObject } from "@chief/relay-contracts";

import { handleChannelLocalTool } from "../../../channel-local-tools.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { recommendPluginsDefinition } from "../../toolkits/plugins/recommend-plugins.js";

export const recommendPluginsTool = defineLocalTool({
  ...recommendPluginsDefinition,
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
