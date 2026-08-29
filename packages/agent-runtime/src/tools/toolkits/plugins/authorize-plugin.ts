import { pathParameter } from "../../path-parameter.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

export const authorizePluginTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/plugins/{pluginId}/authorize",
  operation: {
    operationId: "plugins.authorize",
    summary: "Request user authorization for a plugin",
  },
  async execute(request) {
    if (!request.context.plugins) {
      return jsonResponse({ error: "Plugin service is unavailable." }, 503);
    }
    return jsonResponse(
      await request.context.plugins.authorize(
        pathParameter(request, "pluginId"),
      ),
    );
  },
});
