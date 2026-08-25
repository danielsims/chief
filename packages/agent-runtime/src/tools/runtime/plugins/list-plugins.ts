import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { searchPlugins } from "../../toolkits/plugins/context.js";
import { listPluginsDefinition } from "../../toolkits/plugins/list-plugins.js";

export const listPluginsTool = defineLocalTool({
  ...listPluginsDefinition,
  async execute({ context, request }) {
    if (!context.plugins) {
      return jsonResponse({ error: "Plugin service is unavailable." }, 503);
    }
    const query = listPluginsDefinition.querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return jsonResponse(
      searchPlugins(
        await context.plugins.list(query.refresh),
        query.query,
        query.limit,
      ),
    );
  },
});
