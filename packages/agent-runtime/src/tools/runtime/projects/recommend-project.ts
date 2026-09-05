import { toJsonObject } from "@chief/relay-contracts";

import { handleChannelLocalTool } from "../../../channel-local-tools.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { recommendProjectDefinition } from "../../toolkits/projects/recommend-project.js";

export const recommendProjectTool = defineLocalTool({
  ...recommendProjectDefinition,
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
      channelContext,
    );
    return jsonResponse(result.value, result.status);
  },
});
