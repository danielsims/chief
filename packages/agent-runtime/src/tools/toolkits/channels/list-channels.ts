import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { optionalBoundedText } from "../../input.js";

export const listChannelsDefinition = defineAgentTool({
  method: "GET",
  path: "/local-tools/channels",
  operation: {
    operationId: "channels.list",
    summary: "List workspace channels",
  },
  querySchema: z.object({
    includeArchived: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
    query: optionalBoundedText(120),
  }),
});
