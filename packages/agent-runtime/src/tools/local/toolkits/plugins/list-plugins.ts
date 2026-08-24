import { z } from "zod";

import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { searchPlugins } from "./context.js";

export const listPluginsQuerySchema = z.object({
  query: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(20).default(8),
  refresh: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export const listPluginsTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/plugins",
  operation: {
    operationId: "plugins.list",
    summary: "List available and installed plugins",
  },
  querySchema: listPluginsQuerySchema,
  async execute({ context, request }) {
    if (!context.plugins) {
      return jsonResponse({ error: "Plugin service is unavailable." }, 503);
    }
    const query = listPluginsQuerySchema.parse(
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
