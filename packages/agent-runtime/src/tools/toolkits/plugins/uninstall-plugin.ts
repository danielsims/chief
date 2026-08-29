import { pathParameter } from "../../path-parameter.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

export const uninstallPluginTool = defineLocalTool({
  method: "DELETE",
  path: "/local-tools/plugins/{pluginId}",
  operation: {
    operationId: "plugins.uninstall",
    summary: "Uninstall a plugin",
  },
  async execute(request) {
    if (!request.context.plugins) {
      return jsonResponse({ error: "Plugin service is unavailable." }, 503);
    }
    return jsonResponse(
      await request.context.plugins.uninstall(
        pathParameter(request, "pluginId"),
      ),
    );
  },
});
