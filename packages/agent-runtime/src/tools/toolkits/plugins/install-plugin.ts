import { z } from "zod";

import { pathParameter } from "../../path-parameter.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const installPluginInputSchema = z.object({
  trusted: z.boolean().default(false),
});

export const installPluginTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/plugins/{pluginId}/install",
  operation: {
    operationId: "plugins.install",
    summary: "Install a plugin",
  },
  inputSchema: installPluginInputSchema,
  async execute(request) {
    if (!request.context.plugins) {
      return jsonResponse({ error: "Plugin service is unavailable." }, 503);
    }
    return jsonResponse(
      await request.context.plugins.install(
        pathParameter(request, "pluginId"),
        request.input.trusted,
      ),
    );
  },
});
