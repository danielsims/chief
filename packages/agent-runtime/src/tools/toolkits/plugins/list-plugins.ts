import { z } from "zod";

import { defineAgentTool } from "../../definition.js";

export const listPluginsDefinition = defineAgentTool({
  method: "GET",
  path: "/local-tools/plugins",
  operation: {
    operationId: "plugins.list",
    summary: "List available and installed plugins",
    description:
      "Looks up plugins and their connection state for you. The person never sees this result: to show them plugins, call plugins_recommend.",
  },
  querySchema: z.object({
    query: z.string().trim().max(120).default(""),
    limit: z.coerce.number().int().min(1).max(20).default(8),
    refresh: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
  }),
});
